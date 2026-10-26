/**
 * 타자팡 & 럭키팡 공통 PeerJS 방 관리 모듈 (src/net/room.js)
 * 
 * 원칙:
 * 1. 외부 서비스 키 없음 (Zero-Config 완전 무서버 WebRTC P2P)
 * 2. PeerJS 기본 공용 서버(0.peerjs.com 및 기본 STUN/TURN) 그대로 사용 (iceServers 덮어쓰지 않음)
 * 3. 10초 타임아웃 및 재연결 안정화, 실패 시 onFail / onHostLost 발동 (수업 중단 방지)
 * 4. 한 방 최대 25명 정원 제한 (기존 학생 재접속 제외)
 * 5. 메시지 규격: { type, data }
 *    - type 목록: join, joined, kick, start, progress, board, event, end
 * 6. Next.js SSR 안전을 위해 peerjs는 브라우저 런타임에 동적 import(await import) 사용
 */

export const MAX_ROOM_CAPACITY = 25;
export const CONNECT_TIMEOUT_MS = 10000;
export const RECONNECT_INTERVAL_MS = 3000;
export const RECONNECT_SINGLE_TIMEOUT_MS = 5000;
export const MAX_RECONNECT_ATTEMPTS = 5;
export const MAX_CODE_RETRY = 5;

// 6자리 난수 코드 생성 함수
export function generateRoomCode() {
  return Math.floor(100000 + Math.random() * 900000).toString();
}

/**
 * ============================================================
 * 교사 (호스트) 방 관리 클래스
 * ============================================================
 */
export class HostRoom {
  /**
   * @param {Object} options
   * @param {string} [options.gameName='tajapang'] - 게임 식별자
   * @param {Function} [options.onReady] - 방 생성 완료 콜백 (code, peerId)
   * @param {Function} [options.onStudentJoin] - 학생 입장 콜백 ({ peerId, nickname, ... })
   * @param {Function} [options.onStudentLeave] - 학생 퇴장 콜백 (peerId)
   * @param {Function} [options.onProgress] - 학생 진척도 수신 콜백 (peerId, data)
   * @param {Function} [options.onMessage] - 기타 메시지 수신 콜백 (peerId, { type, data })
   * @param {Function} [options.onError] - 에러 콜백 (err)
   */
  constructor(options = {}) {
    this.gameName = options.gameName || 'luckypang';
    this.onReady = options.onReady || (() => {});
    this.onStudentJoin = options.onStudentJoin || (() => {});
    this.onStudentLeave = options.onStudentLeave || (() => {});
    this.onProgress = options.onProgress || (() => {});
    this.onMessage = options.onMessage || (() => {});
    this.onError = options.onError || (() => {});

    this.code = '';
    this.peerId = '';
    this.peer = null;
    this.students = new Map(); // Map<peerId, { peerId, conn, nickname, joinedAt, lastProgress }>
    this.retryCount = 0;
    this.isDestroyed = false;

    this.handlePageHide = this.handlePageHide.bind(this);
    if (typeof window !== 'undefined') {
      window.addEventListener('pagehide', this.handlePageHide);
    }
  }

  // 방 생성 및 PeerJS 초기화 (동적 import로 SSR 에러 방지)
  async init(preferredCode = null) {
    if (typeof window === 'undefined') return;
    if (this.isDestroyed) return;

    this.code = preferredCode || generateRoomCode();
    this.peerId = `${this.gameName}-${this.code}`;

    // Next.js 서버 렌더링 중 navigator 오류 방지를 위한 동적 import
    const { default: Peer } = await import('peerjs');

    // 6. await import 바로 다음 줄에 isDestroyed 재확인
    if (this.isDestroyed) return;

    // PeerJS 기본 공용 서버(0.peerjs.com) 및 기본 STUN/TURN 사용 (iceServers 덮어쓰지 않음)
    this.peer = new Peer(this.peerId);

    this.peer.on('open', (id) => {
      this.peerId = id;
      this.retryCount = 0;
      this.onReady(this.code, this.peerId);
    });

    // 4. 시그널링 서버 연결 끊김 시 자동 재연결 (새 학생 접속 수신 유지)
    this.peer.on('disconnected', () => {
      console.warn('[HostRoom] 시그널링 서버 연결 끊김 감지. 재연결 시도');
      if (this.peer && !this.peer.destroyed) {
        this.peer.reconnect();
      }
    });

    this.peer.on('error', (err) => {
      // unavailable-id 오류면 새 코드로 최대 5번 재시도
      if (err.type === 'unavailable-id') {
        this.retryCount++;
        if (this.retryCount <= MAX_CODE_RETRY) {
          console.warn(`[HostRoom] 방 코드 중복 (${this.peerId}), 새 코드로 재시도 (${this.retryCount}/${MAX_CODE_RETRY})`);
          if (this.peer && !this.peer.destroyed) {
            this.peer.destroy();
          }
          this.init(); // 새 난수 코드로 재시도
          return;
        }
      }
      this.onError(err);
    });

    // 학생 연결 수신 처리
    this.peer.on('connection', (conn) => {
      this.handleIncomingConnection(conn);
    });
  }

  handleIncomingConnection(conn) {
    if (this.isDestroyed) return;

    // 이미 students에 있는 peerId가 재접속하면 정원(25명) 검사에서 제외
    const isReconnecting = this.students.has(conn.peer);
    if (!isReconnecting && this.students.size >= MAX_ROOM_CAPACITY) {
      conn.on('open', () => {
        conn.send({
          type: 'kick',
          data: '방이 가득 찼어요 (최대 25명)',
        });
        setTimeout(() => {
          conn.close();
        }, 500);
      });
      return;
    }

    conn.on('data', (payload) => {
      if (!payload || typeof payload !== 'object') return;
      const { type, data } = payload;

      switch (type) {
        case 'join': {
          // 재접속이 아닌 신규 학생인 경우만 정원 25명 검사
          const isReconnectingStudent = this.students.has(conn.peer);
          if (!isReconnectingStudent && this.students.size >= MAX_ROOM_CAPACITY) {
            conn.send({ type: 'kick', data: '방이 가득 찼어요 (최대 25명)' });
            setTimeout(() => conn.close(), 500);
            return;
          }

          const rawNickname = (data && data.nickname) ? data.nickname.trim() : `학생-${conn.peer.slice(-4)}`;

          // 같은 닉네임이 있으면 "이름(2)", "이름(3)"처럼 번호 부여 (단, 본인 재접속 제외)
          let assignedNickname = rawNickname;
          const otherNicknames = Array.from(this.students.entries())
            .filter(([pId]) => pId !== conn.peer)
            .map(([, s]) => s.nickname);

          if (otherNicknames.includes(assignedNickname)) {
            let count = 2;
            while (otherNicknames.includes(`${rawNickname}(${count})`)) {
              count++;
            }
            assignedNickname = `${rawNickname}(${count})`;
          }

          const studentInfo = {
            peerId: conn.peer,
            conn,
            nickname: assignedNickname,
            joinedAt: isReconnectingStudent ? (this.students.get(conn.peer)?.joinedAt || Date.now()) : Date.now(),
            lastProgress: this.students.get(conn.peer)?.lastProgress || null,
          };
          this.students.set(conn.peer, studentInfo);

          // onStudentJoin 콜백을 먼저 호출하여 재입장 학생 복구 데이터(restore) 확인
          let restoreData = null;
          try {
            restoreData = this.onStudentJoin(studentInfo);
          } catch (e) {
            console.error('[HostRoom] onStudentJoin error:', e);
          }

          // 학생에게 확정된 닉네임과 (복구 데이터가 있을 시 restore 포함) 입장 승인 전송
          conn.send({
            type: 'joined',
            data: {
              code: this.code,
              peerId: conn.peer,
              nickname: assignedNickname,
              capacity: MAX_ROOM_CAPACITY,
              currentCount: this.students.size,
              ...(restoreData ? { restore: restoreData } : {}),
            },
          });
          break;
        }

        case 'progress': {
          const student = this.students.get(conn.peer);
          if (student) {
            student.lastProgress = data;
          }
          this.onProgress(conn.peer, data);
          break;
        }

        case 'event':
        default: {
          this.onMessage(conn.peer, payload);
          break;
        }
      }
    });

    // 학생 연결 close 처리: students.get(conn.peer).conn === conn 일 때만 삭제
    conn.on('close', () => {
      const student = this.students.get(conn.peer);
      if (student && student.conn === conn) {
        this.students.delete(conn.peer);
        this.onStudentLeave(conn.peer);
      }
    });

    // 학생 연결 error 처리
    conn.on('error', (err) => {
      console.warn(`[HostRoom] 학생(${conn.peer}) 연결 에러:`, err);
      const student = this.students.get(conn.peer);
      if (student && student.conn === conn) {
        this.students.delete(conn.peer);
        this.onStudentLeave(conn.peer);
      }
    });
  }

  // 전체 학생 브로드캐스트 ({ type, data })
  broadcast(type, data) {
    const payload = { type, data };
    this.students.forEach((student) => {
      if (student.conn && student.conn.open) {
        try {
          student.conn.send(payload);
        } catch (e) {
          console.warn(`[HostRoom] 브로드캐스트 실패 (${student.peerId}):`, e);
        }
      }
    });
  }

  // 특정 학생에게 전송
  sendTo(peerId, type, data) {
    const student = this.students.get(peerId);
    if (student && student.conn && student.conn.open) {
      try {
        student.conn.send({ type, data });
      } catch (e) {
        console.warn(`[HostRoom] sendTo 실패 (${peerId}):`, e);
      }
    }
  }

  // 학생 강퇴
  kick(peerId, reason = '선생님에 의해 내보내졌습니다.') {
    const student = this.students.get(peerId);
    if (student) {
      if (student.conn && student.conn.open) {
        try {
          student.conn.send({ type: 'kick', data: reason });
          setTimeout(() => {
            try { student.conn.close(); } catch (_) {}
          }, 300);
        } catch (_) {}
      }
      this.students.delete(peerId);
      this.onStudentLeave(peerId);
    }
  }

  // 게임 시작 브로드캐스트 (지문 및 카운트다운 신호)
  start(passageData, countdown = 3) {
    this.broadcast('start', {
      passage: passageData,
      countdown,
      startedAt: Date.now() + countdown * 1000,
    });
  }

  // 1초마다 순위표(board) 방송
  sendBoard(rankingData) {
    this.broadcast('board', rankingData);
  }

  // 게임 종료 브로드캐스트 (최종 순위 및 결과)
  end(finalResults) {
    this.broadcast('end', finalResults);
  }

  // 이벤트 브로드캐스트
  sendEvent(eventName, payload) {
    this.broadcast('event', { name: eventName, payload });
  }

  // 콜백 동적 갱신 (대기실 -> 인게임 화면 전환 시 연결 유지 지원)
  updateCallbacks(newCallbacks = {}) {
    if (newCallbacks.onReady) this.onReady = newCallbacks.onReady;
    if (newCallbacks.onStudentJoin) this.onStudentJoin = newCallbacks.onStudentJoin;
    if (newCallbacks.onStudentLeave) this.onStudentLeave = newCallbacks.onStudentLeave;
    if (newCallbacks.onProgress) this.onProgress = newCallbacks.onProgress;
    if (newCallbacks.onMessage) this.onMessage = newCallbacks.onMessage;
    if (newCallbacks.onError) this.onError = newCallbacks.onError;
  }

  // 브라우저 탭 닫힘 핸들러 (pagehide 사용으로 확인창 취소 시 방 유지)
  handlePageHide() {
    this.destroy();
  }

  // 리소스 해제
  destroy() {
    if (this.isDestroyed) return;
    this.isDestroyed = true;

    if (typeof window !== 'undefined') {
      window.removeEventListener('pagehide', this.handlePageHide);
    }

    // 학생들에게 방 종료 알림 (data.reason 명시)
    this.broadcast('end', { reason: '호스트가 방을 종료했습니다.' });

    this.students.forEach((student) => {
      try {
        if (student.conn) student.conn.close();
      } catch (_) {}
    });
    this.students.clear();

    if (this.peer && !this.peer.destroyed) {
      try {
        this.peer.destroy();
      } catch (_) {}
    }
  }
}

/**
 * ============================================================
 * 학생 (게스트) 방 연결 클래스
 * ============================================================
 */
export class GuestRoom {
  /**
   * @param {Object} options
   * @param {string} [options.gameName='tajapang'] - 게임 식별자
   * @param {string} options.code - 교사 6자리 방 코드
   * @param {string} options.nickname - 학생 닉네임
   * @param {Function} [options.onJoined] - 연결 및 입장 성공 콜백 (data)
   * @param {Function} [options.onFail] - 10초 내 미연결 시 콜백 (err)
   * @param {Function} [options.onHostLost] - 교사 연결 끊김 및 재연결 실패 콜백 (err)
   * @param {Function} [options.onStart] - 게임 시작 수신 콜백 (data)
   * @param {Function} [options.onBoard] - 순위표 수신 콜백 (data)
   * @param {Function} [options.onEnd] - 게임 종료 수신 콜백 (data)
   * @param {Function} [options.onKick] - 강퇴 수신 콜백 (reason)
   * @param {Function} [options.onMessage] - 기타 수신 콜백 ({ type, data })
   */
  constructor(options = {}) {
    this.gameName = options.gameName || 'luckypang';
    this.code = options.code;
    this.nickname = options.nickname;
    this.restoreData = null;

    this.onJoined = options.onJoined || (() => {});
    this.onFail = options.onFail || (() => {});
    this.onHostLost = options.onHostLost || (() => {});
    this.onStart = options.onStart || (() => {});
    this.onBoard = options.onBoard || (() => {});
    this.onEnd = options.onEnd || (() => {});
    this.onKick = options.onKick || (() => {});
    this.onMessage = options.onMessage || (() => {});

    this.peer = null;
    this.conn = null;
    this.isConnected = false;
    this.isReconnecting = false; // 3. 재연결 진행 중 플래그
    this.hasJoined = false; // 1. joined 한 번이라도 수신 여부 플래그
    this.hasFailed = false; // 초기 10초 연결 타임아웃 초과 여부 플래그
    this.isHostEnded = false; // 5. 교사 방 종료 수신 및 onHostLost 호출 완료 플래그
    this.isKicked = false;
    this.isDestroyed = false;

    // 10초 초기 연결 타임아웃 타이머
    this.connectTimeoutTimer = null;

    // 재연결 관리 (3초 간격 최대 5번, 회당 5초 타임아웃)
    this.reconnectAttempts = 0;
    this.reconnectTimer = null;
    this.singleAttemptTimeoutTimer = null;

    // 0.5초(500ms) progress 전송 스로틀링 관리
    this.lastProgressSentAt = 0;
    this.pendingProgress = null;
    this.progressThrottleTimer = null;

    this.handlePageHide = this.handlePageHide.bind(this);
    if (typeof window !== 'undefined') {
      window.addEventListener('pagehide', this.handlePageHide);
    }
  }

  // 교사에 연결 시작 (동적 import로 SSR 에러 방지)
  async connect() {
    if (typeof window === 'undefined') return;
    if (this.isDestroyed || this.hasFailed) return;

    // Next.js 서버 렌더링 중 navigator 오류 방지를 위한 동적 import
    const { default: Peer } = await import('peerjs');

    // 6. await import 바로 다음 줄에 isDestroyed 및 hasFailed 재확인
    if (this.isDestroyed || this.hasFailed) return;

    // 10초 초기 연결 타임아웃 감시: 10초 초과 시 peer까지 destroy하고 failed 플래그 설정
    this.clearConnectTimeout();
    this.connectTimeoutTimer = setTimeout(() => {
      if (!this.isConnected && !this.isDestroyed) {
        console.warn(`[GuestRoom] 초기 10초 연결 타임아웃 초과 (방 코드: ${this.code})`);
        this.hasFailed = true;
        this.cleanupConnection();

        if (this.peer && !this.peer.destroyed) {
          try {
            this.peer.destroy();
          } catch (_) {}
          this.peer = null;
        }

        this.onFail(new Error('선생님 방을 찾을 수 없습니다. 방 번호를 다시 확인해 주세요.'));
      }
    }, CONNECT_TIMEOUT_MS);

    try {
      // PeerJS 기본 공용 서버 및 기본 STUN/TURN 사용 (iceServers 덮어쓰지 않음)
      this.peer = new Peer();
    } catch (e) {
      this.clearConnectTimeout();
      this.hasFailed = true;
      this.onFail(e);
      return;
    }

    this.peer.on('open', () => {
      if (this.hasFailed || this.isDestroyed) return;
      this.connectToHost();
    });

    // 시그널링 서버 연결 끊김 시 자동 재연결
    this.peer.on('disconnected', () => {
      if (this.hasFailed || this.isDestroyed) return;
      console.warn('[GuestRoom] 시그널링 서버 연결 끊김 감지. 재연결 시도');
      if (this.peer && !this.peer.destroyed) {
        this.peer.reconnect();
      }
    });

    this.peer.on('error', (err) => {
      if (this.hasFailed || this.isDestroyed || this.isHostEnded) return;
      console.warn('[GuestRoom] Peer 에러:', err);

      // 1. peer-unavailable 처리 변경:
      // hasJoined가 true이면 onHostLost를 바로 부르지 않고 재연결 실패 1회로 처리하여 다음 재연결로 진행
      // hasJoined가 false이면 초기 접속 실패이므로 onFail 호출
      if (err.type === 'peer-unavailable') {
        if (this.hasJoined) {
          console.warn('[GuestRoom] 입장 후 peer-unavailable 수신 -> 재연결 실패 처리');
          this.scheduleNextReconnect('peer-unavailable');
        } else {
          this.clearConnectTimeout();
          this.hasFailed = true;
          this.cleanupConnection();
          if (this.peer && !this.peer.destroyed) {
            try { this.peer.destroy(); } catch (_) {}
            this.peer = null;
          }
          this.onFail(new Error('선생님 방을 찾을 수 없습니다. 방 번호를 다시 확인해 주세요.'));
        }
      }
    });
  }

  // 교사 Peer ID로 DataConnection 연결
  connectToHost() {
    if (this.hasFailed || this.isDestroyed || this.isHostEnded) return;
    if (!this.peer || this.peer.destroyed) return;
    const hostPeerId = `${this.gameName}-${this.code}`;

    const currentConn = this.peer.connect(hostPeerId, { reliable: true });
    this.conn = currentConn;

    currentConn.on('open', () => {
      // 2. 해당 conn이 this.conn이 아니면(옛 연결이면) 아무것도 하지 않음
      if (this.conn !== currentConn) return;

      if (this.hasFailed || this.isDestroyed || this.isHostEnded) {
        try { currentConn.close(); } catch (_) {}
        return;
      }

      // 3. 연결이 열리면 isReconnecting = false로 전환
      this.isReconnecting = false;
      this.clearSingleAttemptTimeout();
      this.clearReconnectTimer();
      this.clearConnectTimeout();

      this.isConnected = true;
      this.reconnectAttempts = 0;

      // 교사에게 join 메시지 전송
      currentConn.send({
        type: 'join',
        data: {
          nickname: this.nickname,
        },
      });
    });

    currentConn.on('data', (payload) => {
      // 2. 해당 conn이 this.conn이 아니면 아무것도 하지 않음
      if (this.conn !== currentConn) return;
      if (this.hasFailed || this.isDestroyed || this.isHostEnded) return;
      if (!payload || typeof payload !== 'object') return;
      const { type, data } = payload;

      switch (type) {
        case 'joined': {
          // joined를 한 번이라도 받았으면 hasJoined = true로 표시
          this.hasJoined = true;
          if (data && data.nickname) {
            this.nickname = data.nickname; // 방에서 확정해준 닉네임(중복 번호 포함)으로 동기화
          }
          if (data && data.restore) {
            this.restoreData = data.restore; // 복구 데이터 보관
          }
          this.onJoined(data);
          break;
        }

        case 'kick': {
          this.isKicked = true;
          this.onKick(data);
          this.destroy();
          break;
        }

        case 'start': {
          this.onStart(data);
          break;
        }

        case 'board': {
          this.onBoard(data);
          break;
        }

        case 'end': {
          // 5. end 메시지에 data.reason이 있으면 교사가 방을 닫은 것으로 보고, 재연결하지 않고 onHostLost 호출
          if (data && data.reason) {
            console.warn('[GuestRoom] 교사 방 종료 수신:', data.reason);
            this.triggerHostLost(new Error(data.reason));
          } else {
            this.onEnd(data);
          }
          break;
        }

        case 'event':
        default: {
          this.onMessage(payload);
          break;
        }
      }
    });

    currentConn.on('close', () => {
      // 2. 해당 conn이 this.conn이 아니면 아무것도 하지 않음
      if (this.conn !== currentConn) return;
      if (this.hasFailed || this.isDestroyed || this.isHostEnded) return;
      this.handleDisconnect('conn-close');
    });

    currentConn.on('error', (err) => {
      // 2. 해당 conn이 this.conn이 아니면 아무것도 하지 않음
      if (this.conn !== currentConn) return;
      if (this.hasFailed || this.isDestroyed || this.isHostEnded) return;
      console.warn('[GuestRoom] DataConnection 에러:', err);
      this.handleDisconnect('conn-error');
    });
  }

  // 연결 끊김 감지 핸들러
  handleDisconnect(reason = 'disconnect') {
    this.isConnected = false;
    // 강퇴되었거나, 교사가 방을 종료했거나, 10초 타임아웃 실패했거나, destroy된 경우 재연결하지 않음
    if (this.isKicked || this.isHostEnded || this.isDestroyed || this.hasFailed) return;

    // 3. 이미 재연결 중이면 중복 시작 방지
    if (this.isReconnecting) return;

    // 4. 실패 처리를 한 곳(scheduleNextReconnect)으로 모아서 3초 후 다음 시도
    this.scheduleNextReconnect(reason);
  }

  /**
   * 4. 재연결 실패 통합 스케줄러 (한 시도에 한 번만 카운트, 항상 3초 대기 후 재시도)
   * 시간 초과, close, error, peer-unavailable 모두 이 메서드로 수렴
   */
  scheduleNextReconnect(reason = 'unknown') {
    if (this.isKicked || this.isHostEnded || this.isDestroyed || this.hasFailed) return;

    // 이미 3초 대기 타이머가 돌고 있다면 이번 시도에 대한 실패 처리가 이미 된 것이므로 중복 카운트 방지
    if (this.reconnectTimer) return;

    this.isReconnecting = true;
    this.isConnected = false;
    this.clearSingleAttemptTimeout();

    // 이전 연결 정리
    if (this.conn) {
      try { this.conn.close(); } catch (_) {}
      this.conn = null;
    }

    this.reconnectAttempts++;
    console.warn(`[GuestRoom] 재연결 실패 (${reason}). 시도 횟수: ${this.reconnectAttempts}/${MAX_RECONNECT_ATTEMPTS}`);

    // 5회 모두 실패 시 onHostLost 호출
    if (this.reconnectAttempts > MAX_RECONNECT_ATTEMPTS) {
      console.warn('[GuestRoom] 최대 재연결 시도(5회) 초과 -> onHostLost 호출');
      this.triggerHostLost(new Error('선생님과의 연결이 종료되었습니다.'));
      return;
    }

    // 항상 3초 기다린 뒤 다음 시도
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      if (this.isKicked || this.isHostEnded || this.isDestroyed || this.hasFailed) return;
      this.executeReconnectAttempt();
    }, RECONNECT_INTERVAL_MS);
  }

  // 실제 단일 재연결 시도 실행 (5초 제한 시간 부여)
  executeReconnectAttempt() {
    if (this.isKicked || this.isHostEnded || this.isDestroyed || this.hasFailed) return;
    console.warn(`[GuestRoom] 재연결 ${this.reconnectAttempts}회차 연결 시도 시작`);

    // 7. 재연결 시도마다 5초 제한 시간 타이머 설정
    this.clearSingleAttemptTimeout();
    this.singleAttemptTimeoutTimer = setTimeout(() => {
      if (!this.isConnected && !this.isDestroyed && !this.hasFailed && !this.isHostEnded) {
        console.warn(`[GuestRoom] 재연결 ${this.reconnectAttempts}회차 5초 제한시간 초과`);
        this.scheduleNextReconnect('5s-timeout');
      }
    }, RECONNECT_SINGLE_TIMEOUT_MS);

    this.connectToHost();
  }

  /**
   * 5. onHostLost 호출 전용 메서드: isHostEnded = true로 먼저 설정하여 중복 호출 및 이후 재연결을 원천 차단
   */
  triggerHostLost(err) {
    if (this.isHostEnded) return;
    this.isHostEnded = true; // 5. onHostLost 부르기 전에 isHostEnded = true 설정
    this.isReconnecting = false;
    this.cleanupConnection();

    try {
      this.onHostLost(err || new Error('선생님과의 연결이 종료되었습니다.'));
    } catch (e) {
      console.error('[GuestRoom] onHostLost 콜백 에러:', e);
    }
  }

  /**
   * 학생 타자 진행률 전송 (0.5초 간격 쓰로틀링 적용)
   * 키 입력마다 즉시 보내지 않고, 최소 500ms 간격으로 배치 전송
   * @param {Object} progressData - { progress, accuracy, cpm, currentIdx, score, combo }
   */
  sendProgress(progressData) {
    if (this.hasFailed || this.isDestroyed || this.isHostEnded || !this.conn || !this.isConnected) return;

    this.pendingProgress = progressData;
    const now = Date.now();
    const elapsed = now - this.lastProgressSentAt;

    if (elapsed >= 500) {
      this.flushProgress();
    } else {
      if (!this.progressThrottleTimer) {
        this.progressThrottleTimer = setTimeout(() => {
          this.progressThrottleTimer = null;
          this.flushProgress();
        }, 500 - elapsed);
      }
    }
  }

  flushProgress() {
    if (this.hasFailed || this.isDestroyed || this.isHostEnded || !this.conn || !this.isConnected || !this.pendingProgress) return;
    try {
      this.conn.send({
        type: 'progress',
        data: this.pendingProgress,
      });
      this.lastProgressSentAt = Date.now();
      this.pendingProgress = null;
    } catch (e) {
      console.warn('[GuestRoom] progress 전송 실패:', e);
    }
  }

  // 일반 이벤트 전송
  sendEvent(eventName, payload) {
    if (this.hasFailed || this.isDestroyed || this.isHostEnded || !this.conn || !this.isConnected) return;
    try {
      this.conn.send({
        type: 'event',
        data: { name: eventName, payload },
      });
    } catch (e) {
      console.warn('[GuestRoom] event 전송 실패:', e);
    }
  }

  clearConnectTimeout() {
    if (this.connectTimeoutTimer) {
      clearTimeout(this.connectTimeoutTimer);
      this.connectTimeoutTimer = null;
    }
  }

  clearSingleAttemptTimeout() {
    if (this.singleAttemptTimeoutTimer) {
      clearTimeout(this.singleAttemptTimeoutTimer);
      this.singleAttemptTimeoutTimer = null;
    }
  }

  clearReconnectTimer() {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
  }

  cleanupConnection() {
    this.clearConnectTimeout();
    this.clearSingleAttemptTimeout();
    this.clearReconnectTimer();
    this.isReconnecting = false;

    if (this.progressThrottleTimer) {
      clearTimeout(this.progressThrottleTimer);
      this.progressThrottleTimer = null;
    }
    if (this.conn) {
      try { this.conn.close(); } catch (_) {}
      this.conn = null;
    }
  }

  // 콜백 동적 갱신 (대기실 -> 인게임 화면 전환 시 연결 유지 지원)
  updateCallbacks(newCallbacks = {}) {
    if (newCallbacks.onJoined) this.onJoined = newCallbacks.onJoined;
    if (newCallbacks.onFail) this.onFail = newCallbacks.onFail;
    if (newCallbacks.onHostLost) this.onHostLost = newCallbacks.onHostLost;
    if (newCallbacks.onStart) this.onStart = newCallbacks.onStart;
    if (newCallbacks.onBoard) this.onBoard = newCallbacks.onBoard;
    if (newCallbacks.onEnd) this.onEnd = newCallbacks.onEnd;
    if (newCallbacks.onKick) this.onKick = newCallbacks.onKick;
    if (newCallbacks.onMessage) this.onMessage = newCallbacks.onMessage;
  }

  handlePageHide() {
    this.destroy();
  }

  destroy() {
    if (this.isDestroyed) return;
    this.isDestroyed = true;

    if (typeof window !== 'undefined') {
      window.removeEventListener('pagehide', this.handlePageHide);
    }

    this.cleanupConnection();

    if (this.peer && !this.peer.destroyed) {
      try {
        this.peer.destroy();
      } catch (_) {}
      this.peer = null;
    }
  }
}

/**
 * ============================================================
 * 페이지 이동(대기실 -> 인게임) 간 연결 유지를 위한 싱글톤 관리 헬퍼
 * ============================================================
 */
let activeHostRoom = null;
let activeGuestRoom = null;

export function getActiveHostRoom() {
  if (typeof window !== 'undefined' && window.__luckypangHostRoom) {
    return window.__luckypangHostRoom;
  }
  return activeHostRoom;
}

export function setActiveHostRoom(room) {
  activeHostRoom = room;
  if (typeof window !== 'undefined') {
    window.__luckypangHostRoom = room;
  }
}

export function getActiveGuestRoom() {
  if (typeof window !== 'undefined' && window.__luckypangGuestRoom) {
    return window.__luckypangGuestRoom;
  }
  return activeGuestRoom;
}

export function setActiveGuestRoom(room) {
  activeGuestRoom = room;
  if (typeof window !== 'undefined') {
    window.__luckypangGuestRoom = room;
  }
}
