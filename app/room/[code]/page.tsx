"use client";

import React, { useState, useEffect, useRef, useMemo } from "react";
import { useSearchParams, useParams, useRouter } from "next/navigation";
import { saveLuckyRecord } from "../../../lib/party";
import {
  HostRoom,
  GuestRoom,
  getActiveHostRoom,
  setActiveHostRoom,
  getActiveGuestRoom,
  setActiveGuestRoom,
} from "../../../src/net/room";
import {
  Quiz,
  QuizOption,
  generateQuizForRound,
  shuffleOptions,
  calculateTicketBonus,
} from "../../../lib/mathEngine";
import QuizCard from "../../../components/QuizCard";
import TicketInventory from "../../../components/TicketInventory";
import LuckyDrawMachine from "../../../components/LuckyDrawMachine";
import ResultExport from "../../../components/ResultExport";
import { QRCodeSVG } from "qrcode.react";
import { appAlert, appConfirm, isReloadKey } from "@/lib/appDialog";

// 로컬 시뮬레이션을 위한 더미 가상 봇들
const DUMMY_BOTS = [
  { id: "bot_1", nickname: "김민수", student_number: "03", score: 0, bonus_score: 0, ticket_count: 0, tickets: [] as any[] },
  { id: "bot_2", nickname: "이영희", student_number: "07", score: 0, bonus_score: 0, ticket_count: 0, tickets: [] as any[] },
  { id: "bot_3", nickname: "박철수", student_number: "12", score: 0, bonus_score: 0, ticket_count: 0, tickets: [] as any[] },
  { id: "bot_4", nickname: "최수민", student_number: "20", score: 0, bonus_score: 0, ticket_count: 0, tickets: [] as any[] },
];

function GameRoomPageInner() {
  const params = useParams();
  const searchParams = useSearchParams();
  const router = useRouter();

  const roomCode = params.code as string;
  const [displayRoomCode, setDisplayRoomCode] = useState(roomCode);
  const [isTeacher, setIsTeacher] = useState(false);
  const [nickname, setNickname] = useState("");
  const [myId, setMyId] = useState("");
  const [showFallbackModal, setShowFallbackModal] = useState(false);
  const [fallbackReason, setFallbackReason] = useState("");

  // [모드 관리] 교사는 sessionStorage, 학생은 교사의 board/start 방송을 통해 동기화
  const [gameMode, setGameMode] = useState<"standard" | "extreme">("standard");
  const gameModeRef = useRef<"standard" | "extreme">("standard");
  useEffect(() => { gameModeRef.current = gameMode; }, [gameMode]);
  const mode = gameMode;

  // [게임 회차 번호] 새로고침 또는 재시작 시에도 이전과 완전히 다른 새로운 문제 생성을 보장하기 위해 고유 세션 시드 적용
  const [gameSession, setGameSession] = useState<number>(() => {
    if (typeof window !== "undefined") {
      const stored = sessionStorage.getItem("luckypang_game_session");
      if (stored) return parseInt(stored, 10) || 1;
      const initialSeed = (Math.floor(Date.now() / 1000) % 100000) + 1;
      sessionStorage.setItem("luckypang_game_session", String(initialSeed));
      return initialSeed;
    }
    return 1;
  });
  const gameSessionRef = useRef<number>(1);
  useEffect(() => {
    gameSessionRef.current = gameSession;
    if (typeof window !== "undefined") {
      sessionStorage.setItem("luckypang_game_session", String(gameSession));
    }
  }, [gameSession]);

  const isHost = isTeacher;
  const isPlayer = !isTeacher;
  const role = isTeacher ? "host" : "player";
  const dbRoomId = displayRoomCode || roomCode;
  const dbPlayerId = myId;
  const isLocalSim = false;

  const ROUND_PRESETS = [6, 12, 18, 24, 30];

  // --- 공통 상태 및 메타데이터 파싱 ---
  const [roomStatusRaw, setRoomStatusRaw] = useState<string>("waiting");
  const [currentRound, setCurrentRound] = useState(1);
  const [roundStatus, setRoundStatus] = useState<"show_question" | "show_answer">("show_question");
  const [players, setPlayers] = useState<any[]>([]);
  const [winningNumbers, setWinningNumbers] = useState<number[]>([]);
  const [drawRevealedCount, setDrawRevealedCount] = useState<number>(0);
  const [showPlayersModal, setShowPlayersModal] = useState(false); // 참가자 실시간 목록 모달 토글
  const [isPendingHostAction, setIsPendingHostAction] = useState(false); // 교사 액션 비동기 펜딩 방어 상태

  // 최신 값 참조 Ref (타이머 및 클로저 방어)
  const playersRef = useRef<any[]>([]);
  const roomStatusRawRef = useRef<string>("waiting");
  const currentRoundRef = useRef<number>(1);
  const roundStatusRef = useRef<string>("show_question");
  const winningNumbersRef = useRef<number[]>([]);
  const drawRevealedCountRef = useRef<number>(0);
  // [채점 대기 맵] round -> peerId -> optionId (정답 공개 전 마지막 답안만 저장)
  const pendingAnswersRef = useRef<{ [round: number]: { [peerId: string]: string } }>({});
  const currentQuizRef = useRef<Quiz | null>(null);

  useEffect(() => { playersRef.current = players; }, [players]);
  useEffect(() => { roomStatusRawRef.current = roomStatusRaw; }, [roomStatusRaw]);
  useEffect(() => { currentRoundRef.current = currentRound; }, [currentRound]);
  useEffect(() => { roundStatusRef.current = roundStatus; }, [roundStatus]);
  useEffect(() => { winningNumbersRef.current = winningNumbers; }, [winningNumbers]);
  useEffect(() => { drawRevealedCountRef.current = drawRevealedCount; }, [drawRevealedCount]);

  // status 문자열로부터 메타데이터 파싱 헬퍼
  const parseStatusMeta = (statusStr: string) => {
    if (!statusStr) return { status: "waiting", totalRounds: 12, difficulty: "easy", ratio: "1:1:1" };

    // 예: waiting:20:mix:3:2:1 또는 host_disconnected:playing:20:mix:3:2:1
    const parts = statusStr.split(":");
    let status = parts[0];
    let offset = 0;

    // 만약 host_disconnected 상태라면 백업 상태를 읽어옴
    if (status === "host_disconnected") {
      status = parts[1] || "playing";
      offset = 1;
    }

    const totalRounds = parseInt(parts[1 + offset]) || 12;
    const difficulty = parts[2 + offset] || "easy";
    // difficulty가 mix인 경우, 3+offset 이후의 모든 조각들을 다시 : 로 결합하여 '3:2:1' 복원
    const ratio = difficulty === "mix"
      ? parts.slice(3 + offset).join(":")
      : parts[3 + offset] || "none";

    return { status, totalRounds, difficulty, ratio };
  };

  const roomMeta = useMemo(() => {
    return parseStatusMeta(roomStatusRaw);
  }, [roomStatusRaw]);

  const roomStatus = roomMeta.status;
  const totalRounds = roomMeta.totalRounds;
  const roomDifficulty = roomMeta.difficulty;
  const roomRatio = roomMeta.ratio;

  // 교사용 방 상태 업데이트 시 기존 메타데이터를 보존하여 갱신하는 헬퍼 함수
  const updateRoomStatusWithMeta = async (newStatus: string) => {
    const statusMeta = `${newStatus}:${totalRounds}:${roomDifficulty}:${roomRatio}`;
    setRoomStatusRaw(statusMeta);
    const host = getActiveHostRoom();
    if (host) {
      host.sendBoard({
        status: statusMeta,
        mode: gameModeRef.current,
        gameState: {
          mode: gameModeRef.current,
          current_round: currentRoundRef.current,
          total_rounds: totalRounds,
          round_status: roundStatusRef.current,
          winning_numbers: winningNumbersRef.current,
          draw_revealed_count: drawRevealedCountRef.current,
        },
        players: playersRef.current,
      });
    }
  };

  // 최신 설정값 참조 Ref (교사 채점 stale closure 완전 방어)
  const totalRoundsRef = useRef<number>(totalRounds);
  const roomDifficultyRef = useRef<string>(roomDifficulty);
  const roomRatioRef = useRef<string>(roomRatio);
  const roomCodeRef = useRef<string>(roomCode);

  useEffect(() => { totalRoundsRef.current = totalRounds; }, [totalRounds]);
  useEffect(() => { roomDifficultyRef.current = roomDifficulty; }, [roomDifficulty]);
  useEffect(() => { roomRatioRef.current = roomRatio; }, [roomRatio]);
  useEffect(() => {
    const baseCode = displayRoomCode || roomCode;
    roomCodeRef.current = `${baseCode}_s${gameSession}`;
  }, [displayRoomCode, roomCode, gameSession]);

  // 학생 제출 캐시 일괄 삭제 헬퍼 (새 게임 또는 리셋 시 호출)
  const clearSubmitCache = (codeStr: string) => {
    if (typeof window === "undefined" || !codeStr) return;
    try {
      const prefix = `luckypang_submit_room_${codeStr}_round_`;
      const keysToRemove: string[] = [];
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (k && k.startsWith(prefix)) {
          keysToRemove.push(k);
        }
      }
      keysToRemove.forEach((k) => localStorage.removeItem(k));
    } catch (e) {
      console.warn("제출 캐시 초기화 실패:", e);
    }
  };

  // --- 학생 상태 ---
  const [currentQuiz, setCurrentQuiz] = useState<Quiz | null>(null);
  useEffect(() => { currentQuizRef.current = currentQuiz; }, [currentQuiz]);
  const [myTickets, setMyTickets] = useState<any[]>([]);
  const [myScore, setMyScore] = useState(0);
  const [myBonusScore, setMyBonusScore] = useState(0);
  const [hasSubmittedThisRound, setHasSubmittedThisRound] = useState(false);
  const [mySelectedOption, setMySelectedOption] = useState<QuizOption | null>(null);
  const [showResultModal, setShowResultModal] = useState(false);
  const [showTicketModal, setShowTicketModal] = useState(false);
  const [hostDisconnectTimer, setHostDisconnectTimer] = useState<number | null>(null); // 방장 이탈 대기 타이머 (초)
  const [myRoundResults, setMyRoundResults] = useState<{ round: number; isCorrect: boolean }[]>([]); // 학생 라운드별 정오답 결과 기록

  // --- 가상 시뮬레이션 상태 ---
  const [bots, setBots] = useState<any[]>([]);
  const [quizForRound, setQuizForRound] = useState<Quiz | null>(null);
  const [showRanking, setShowRanking] = useState(true); // 랭킹보드 토글 상태
  const [copied, setCopied] = useState(false); // 방 코드 복사 피드백 상태
  const [toastMessage, setToastMessage] = useState("");
  const [inviteLink, setInviteLink] = useState("");
  const [showQrModal, setShowQrModal] = useState(false);

  useEffect(() => {
    if (typeof window !== "undefined") {
      setInviteLink(`${window.location.origin}/?code=${displayRoomCode || roomCode}`);
    }
  }, [displayRoomCode, roomCode]);

  useEffect(() => {
    if (!toastMessage) return;
    const timer = setTimeout(() => {
      setToastMessage("");
    }, 2000);
    return () => clearTimeout(timer);
  }, [toastMessage]);

  // --- 새로고침 및 뒤로가기 방지 3중 가드 (Beforeunload + Popstate + Keydown) ---
  const isExitingRef = useRef(false);

  useEffect(() => {
    if (typeof window === "undefined") return;

    // 1. 브라우저 새로고침/창닫기(F5, 브라우저 새로고침 버튼, 탭/창 닫기) 시 이탈 방지 경고 대화상자 호출
    const handleBeforeUnload = (e: BeforeUnloadEvent) => {
      if (isExitingRef.current) return;
      e.preventDefault();
      e.returnValue = "게임 진행 중 페이지를 벗어나면 연결이 종료됩니다. 계속 진행하시겠습니까?";
      return e.returnValue;
    };

    // 2. 키보드 단축키(F5, Ctrl+R, Alt+좌화살표 등) 차단
    const handleKeyDown = (e: KeyboardEvent) => {
      if (isExitingRef.current) return;

      // F5 또는 Ctrl+R / Command+R 새로고침 방지
      if (isReloadKey(e)) {
        e.preventDefault();
        setToastMessage("⚠️ 게임 진행 중 새로고침은 비활성화되어 있습니다.");
        return;
      }

      // Alt + 왼쪽 화살표 (뒤로가기 단축키) 방지
      if (e.altKey && e.key === "ArrowLeft") {
        e.preventDefault();
        setToastMessage("⚠️ 게임 진행 중 뒤로가기는 비활성화되어 있습니다.");
        return;
      }

      // Backspace 뒤로가기 방지 (텍스트 입력 필드가 아닐 때)
      if (e.key === "Backspace") {
        const target = e.target as HTMLElement;
        const isInputField =
          target &&
          (target.tagName === "INPUT" ||
            target.tagName === "TEXTAREA" ||
            target.isContentEditable);
        if (!isInputField) {
          e.preventDefault();
        }
      }
    };

    // 3. 브라우저 뒤로가기 (마우스 뒤로가기 단추, 제스처, 히스토리 뒤로가기) 차단
    window.history.pushState(null, "", window.location.href);

    const handlePopState = () => {
      if (isExitingRef.current) return;
      window.history.pushState(null, "", window.location.href);
      setToastMessage("⚠️ 게임 진행 중에는 뒤로가기를 할 수 없습니다. 종료하시려면 상단의 [나가기] 버튼을 이용해주세요.");
    };

    window.addEventListener("beforeunload", handleBeforeUnload);
    window.addEventListener("keydown", handleKeyDown);
    window.addEventListener("popstate", handlePopState);

    return () => {
      window.removeEventListener("beforeunload", handleBeforeUnload);
      window.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("popstate", handlePopState);
    };
  }, []);

  // 안전한 클립보드 복사 헬퍼 (Document is not focused 등 브라우저 보안 에러 방어)
  const copyToClipboard = async (text: string, successMsg: string) => {
    try {
      if (navigator?.clipboard?.writeText) {
        await navigator.clipboard.writeText(text);
        setToastMessage(successMsg);
        return;
      }
    } catch (err) {
      console.warn("Clipboard writeText failed, trying fallback:", err);
    }
    try {
      const textarea = document.createElement("textarea");
      textarea.value = text;
      textarea.style.position = "fixed";
      textarea.style.opacity = "0";
      document.body.appendChild(textarea);
      textarea.focus();
      textarea.select();
      document.execCommand("copy");
      document.body.removeChild(textarea);
      setToastMessage(successMsg);
    } catch (e) {
      console.error("Copy fallback failed:", e);
      setToastMessage("복사에 실패했습니다. 수동으로 복사해 주세요.");
    }
  };

  const handleCopyRoomCode = () => {
    copyToClipboard(displayRoomCode || roomCode, "방 번호가 복사되었습니다! 📋");
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  const [bookmarkedQuizzes, setBookmarkedQuizzes] = useState<{ round: number; quiz: Quiz }[]>([]); // 학생 책갈피 문제 목록
  const [showReviewModal, setShowReviewModal] = useState(false); // 책갈피 복습 모달 토글

  const handleToggleBookmark = () => {
    if (!currentQuiz || !dbRoomId) return;
    const cacheKey = `luckypang_bookmarks_room_${dbRoomId}`;
    const isExist = bookmarkedQuizzes.some((q) => q.round === currentRound);
    let nextList = [];
    if (isExist) {
      nextList = bookmarkedQuizzes.filter((q) => q.round !== currentRound);
    } else {
      nextList = [...bookmarkedQuizzes, { round: currentRound, quiz: currentQuiz }];
    }
    setBookmarkedQuizzes(nextList);
    localStorage.setItem(cacheKey, JSON.stringify(nextList));
  };

  // 6자리 무작위 럭키팡 번호 생성 유틸
  const generateLottoNumbers = () => {
    const nums: number[] = [];
    while (nums.length < 6) {
      const n = Math.floor(Math.random() * 45) + 1;
      if (!nums.includes(n)) nums.push(n);
    }
    return nums.sort((a, b) => a - b);
  };

  // --- 1. 교사용 1초 주기 순위표 및 게임 상태 브로드캐스트 (sendBoard) ---
  useEffect(() => {
    if (!isTeacher) return;
    const timer = setInterval(() => {
      const host = getActiveHostRoom();
      if (host) {
        host.sendBoard({
          status: roomStatusRawRef.current,
          mode: gameModeRef.current,
          gameState: {
            mode: gameModeRef.current,
            game_session: gameSessionRef.current,
            current_round: currentRoundRef.current,
            total_rounds: totalRounds,
            round_status: roundStatusRef.current,
            winning_numbers: winningNumbersRef.current,
            draw_revealed_count: drawRevealedCountRef.current,
          },
          players: playersRef.current,
        });
      }
    }, 1000);
    return () => clearInterval(timer);
  }, [isTeacher, totalRounds]);

  // --- 1-1. 교사 브라우저 전담 채점 및 이벤트 처리기 ---
  const handleTeacherMessage = (peerId: string, payload: any) => {
    if (!payload || !payload.type) return;

    if (payload.type === "event") {
      const eventName = payload.data?.name;
      const eventPayload = payload.data?.payload;

      // 1. 학생 답안 제출 (정답 공개 전에는 점수를 바꾸지 않고 마지막 답안만 pendingAnswersRef에 저장)
      if (eventName === "SUBMIT_ANSWER") {
        const { round, optionId } = eventPayload || {};
        if (round === undefined || !optionId) return;

        // [가드 검사] 학생이 보낸 round가 교사의 현재 라운드와 다르거나, 현재 라운드가 이미 정답 공개 상태면 무시
        if (round !== currentRoundRef.current || roundStatusRef.current === "show_answer") {
          return;
        }

        // 답을 바꾸면 덮어씀 (첫 제출만 인정하던 submittedRoundsRef 로직을 대체)
        if (!pendingAnswersRef.current[round]) {
          pendingAnswersRef.current[round] = {};
        }
        pendingAnswersRef.current[round][peerId] = optionId;
        return;
      }

      // 2. 학생 당첨 번호 추첨 완료 (보너스 점수는 교사가 원래 게임 규칙인 4개 미션 달성 수로 직접 계산!)
      else if (eventName === "FINISH_DRAW") {
        setPlayers((prev) =>
          prev.map((p) => {
            if (p.id !== peerId) return p;
            const calculatedBonus = calculateTicketBonus(roomCodeRef.current, p.tickets || []);
            return {
              ...p,
              bonus_score: calculatedBonus,
            };
          })
        );
      }

      // 3. 학생 퇴장
      else if (eventName === "LEAVE") {
        setPlayers((prev) => prev.filter((p) => p.id !== peerId));
      }
    }
  };

  // 새로고침/탭 닫기 방지 경고 이벤트 리스너 (선생님 전용)
  useEffect(() => {
    const isTeacherUser = sessionStorage.getItem("luckypang_is_teacher") === "true";
    if (!isTeacherUser) return;

    const handleBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "페이지를 벗어나면 게임방이 사라지고 접속한 학생들이 모두 퇴장합니다. 정말 이동하시겠습니까?";
      return e.returnValue;
    };

    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => {
      window.removeEventListener("beforeunload", handleBeforeUnload);
    };
  }, []);

  // --- 1-2. PeerJS 실시간 P2P 연결 생명주기 (교사 HostRoom / 학생 GuestRoom) ---
  useEffect(() => {
    if (!roomCode) return;

    const isTeacherUser = sessionStorage.getItem("luckypang_is_teacher") === "true";
    setIsTeacher(isTeacherUser);

    const storedNick = sessionStorage.getItem("luckypang_nickname") || (isTeacherUser ? "선생님" : "학생");
    setNickname(storedNick);

    const initialStatus = sessionStorage.getItem("luckypang_init_status") || `waiting:${totalRounds}:${roomDifficulty}:${roomRatio}`;

    if (isTeacherUser) {
      // ============================================
      // [교사 / 호스트 모드]
      // ============================================
      const initMode = (sessionStorage.getItem("luckypang_init_mode") as "standard" | "extreme") || "standard";
      setGameMode(initMode);
      gameModeRef.current = initMode;

      setMyId("teacher");
      setRoomStatusRaw(initialStatus);

      let host = getActiveHostRoom();
      if (!host || host.code !== roomCode) {
        host = new HostRoom({
          gameName: "luckypang",
          onReady: (code) => {
            console.log(`[Host] 방 개설 완료 (코드: ${code})`);
            if (code && code !== roomCode) {
              setDisplayRoomCode(code);
              router.replace(`/room/${code}`);
            }
          },
          onStudentJoin: (student) => {
            console.log(`[Host] 학생 입장: ${student.nickname} (${student.peerId})`);
            const existingPlayer = playersRef.current.find(
              (p) => p.id === student.peerId || p.nickname === student.nickname
            );

            if (existingPlayer) {
              return {
                score: existingPlayer.score || 0,
                bonus_score: existingPlayer.bonus_score || 0,
                tickets: existingPlayer.tickets || [],
                ticket_count: existingPlayer.ticket_count || 0,
                current_round: currentRoundRef.current,
                round_status: roundStatusRef.current,
              };
            }

            const isPlayingNow =
              roomStatusRawRef.current.startsWith("playing") ||
              roomStatusRawRef.current.startsWith("drawing");

            const newPlayer = {
              id: student.peerId,
              nickname: student.nickname,
              student_number: "00",
              score: 0,
              bonus_score: 0,
              ticket_count: 0,
              tickets: [],
              waitingNextGame: isPlayingNow,
            };

            setPlayers((prev) => [...prev.filter((p) => p.id !== student.peerId), newPlayer]);
            return null;
          },
          onStudentLeave: (peerId) => {
            console.log(`[Host] 학생 퇴장: ${peerId}`);
            setPlayers((prev) => prev.filter((p) => p.id !== peerId));
          },
          onMessage: (peerId, payload) => {
            handleTeacherMessage(peerId, payload);
          },
          onError: (err) => {
            console.error("[Host] 에러:", err);
            appAlert(`방 생성 오류: ${err.message || "네트워크 상태를 확인해주세요."}`);
          },
        });
        setActiveHostRoom(host);
        host.init(roomCode);
      } else {
        const restored: any[] = [];
        if (host.students) {
          host.students.forEach((s: any, pId: string) => {
            const existing = playersRef.current.find((p) => p.id === pId);
            restored.push(
              existing || {
                id: pId,
                nickname: s.nickname,
                student_number: "00",
                score: 0,
                bonus_score: 0,
                ticket_count: 0,
                tickets: [],
              }
            );
          });
        }
        setPlayers((prev) => {
          const existingBots = prev.filter((p) => p.id?.startsWith("bot_") || (p as any).isBot);
          return [...restored, ...existingBots];
        });

        host.updateCallbacks({
          onStudentJoin: (student) => {
            const existingPlayer = playersRef.current.find(
              (p) => p.id === student.peerId || p.nickname === student.nickname
            );
            if (existingPlayer) {
              return {
                score: existingPlayer.score || 0,
                bonus_score: existingPlayer.bonus_score || 0,
                tickets: existingPlayer.tickets || [],
                ticket_count: existingPlayer.ticket_count || 0,
                current_round: currentRoundRef.current,
                round_status: roundStatusRef.current,
              };
            }
            const isPlayingNow =
              roomStatusRawRef.current.startsWith("playing") ||
              roomStatusRawRef.current.startsWith("drawing");
            const newPlayer = {
              id: student.peerId,
              nickname: student.nickname,
              student_number: "00",
              score: 0,
              bonus_score: 0,
              ticket_count: 0,
              tickets: [],
              waitingNextGame: isPlayingNow,
            };
            setPlayers((prev) => [...prev.filter((p) => p.id !== student.peerId), newPlayer]);
            return null;
          },
          onStudentLeave: (peerId) => {
            setPlayers((prev) => prev.filter((p) => p.id !== peerId));
          },
          onMessage: (peerId, payload) => {
            handleTeacherMessage(peerId, payload);
          },
        });
      }
    } else {
      // ============================================
      // [학생 / 게스트 모드]
      // ============================================
      let guest = getActiveGuestRoom();
      if (!guest || guest.code !== roomCode) {
        const newGuest: any = new GuestRoom({
          gameName: "luckypang",
          code: roomCode,
          nickname: storedNick,
          onJoined: (data: any) => {
            const resolvedId = newGuest.peer?.id || storedNick;
            setMyId(resolvedId);

            if (data?.restore) {
              const r = data.restore;
              if (r.score !== undefined) setMyScore(r.score);
              if (r.bonus_score !== undefined) setMyBonusScore(r.bonus_score);
              if (r.tickets) setMyTickets(r.tickets);
              if (r.current_round !== undefined) setCurrentRound(r.current_round);
              if (r.round_status !== undefined) setRoundStatus(r.round_status);
            }

            setPlayers([
              {
                id: resolvedId,
                nickname: data?.nickname || storedNick,
                student_number: "00",
                score: data?.restore?.score ?? myScore,
                bonus_score: data?.restore?.bonus_score ?? myBonusScore,
                ticket_count: data?.restore?.ticket_count ?? myTickets.length,
                tickets: data?.restore?.tickets ?? myTickets,
              },
            ]);
          },
          onBoard: (data: any) => {
            if (!data) return;
            const incomingMode = data.mode || data.gameState?.mode;
            if (incomingMode) {
              setGameMode(incomingMode);
              gameModeRef.current = incomingMode;
            }
            if (data.status) setRoomStatusRaw(data.status);
            if (data.gameState) {
              const gs = data.gameState;
              if (gs.game_session !== undefined) {
                setGameSession(gs.game_session);
                gameSessionRef.current = gs.game_session;
              }
              if (gs.current_round !== undefined) {
                setCurrentRound((prev) => {
                  if (prev !== gs.current_round) {
                    setHasSubmittedThisRound(false);
                    setMySelectedOption(null);
                  }
                  return gs.current_round;
                });
              }
              if (gs.round_status !== undefined) setRoundStatus(gs.round_status);
              if (gs.winning_numbers !== undefined) {
                setWinningNumbers((prev) => {
                  const prevKey = (prev || []).join(",");
                  const newKey = (gs.winning_numbers || []).join(",");
                  return prevKey !== newKey ? gs.winning_numbers : prev;
                });
              }
              if (gs.draw_revealed_count !== undefined) {
                setDrawRevealedCount(gs.draw_revealed_count);
              }
            }
            if (data.players) {
              setPlayers(data.players);
              const resolvedId = newGuest.peer?.id || myId;
              const me = data.players.find((p: any) => p.id === resolvedId);
              if (me) {
                if (me.score !== undefined) setMyScore(me.score);
                if (me.bonus_score !== undefined) setMyBonusScore(me.bonus_score);
                if (me.tickets !== undefined) setMyTickets(me.tickets);
                if (me.selectedAnswer && currentQuizRef.current) {
                  const matched = currentQuizRef.current.options.find((o: any) => o.id === me.selectedAnswer);
                  if (matched) {
                    setMySelectedOption(matched);
                  }
                }
              }
            }
          },
          onStart: (data: any) => {
            clearSubmitCache(roomCode);
            if (data?.mode) {
              setGameMode(data.mode);
              gameModeRef.current = data.mode;
            }
            if (data?.game_session) {
              setGameSession(data.game_session);
              gameSessionRef.current = data.game_session;
            }
            const meta = parseStatusMeta(roomStatusRawRef.current);
            const tR = data?.total_rounds || meta.totalRounds;
            const diff = data?.difficulty || meta.difficulty;
            const rat = data?.ratio || meta.ratio;
            setRoomStatusRaw(`playing:${tR}:${diff}:${rat}`);
            setCurrentRound(data?.current_round || 1);
            setRoundStatus(data?.round_status || "show_question");
          },
          onEnd: (data: any) => {
            const meta = parseStatusMeta(roomStatusRawRef.current);
            const tR = data?.total_rounds || meta.totalRounds;
            const diff = data?.difficulty || meta.difficulty;
            const rat = data?.ratio || meta.ratio;
            setRoomStatusRaw(`finished:${tR}:${diff}:${rat}`);
          },
          onMessage: (payload: any) => {
            if (payload?.type === "event" && payload?.data?.name === "RESET_ROOM") {
              if (payload?.data?.game_session) {
                setGameSession(payload.data.game_session);
                gameSessionRef.current = payload.data.game_session;
              }
              clearSubmitCache(roomCode);
              const meta = parseStatusMeta(roomStatusRawRef.current);
              setRoomStatusRaw(`waiting:${meta.totalRounds}:${meta.difficulty}:${meta.ratio}`);
              setCurrentRound(1);
              setRoundStatus("show_question");
              setWinningNumbers([]);
              setDrawRevealedCount(0);
              setMyScore(0);
              setMyBonusScore(0);
              setMyTickets([]);
              setHasSubmittedThisRound(false);
              setMySelectedOption(null);
            }
          },
          onHostLost: () => {
            setFallbackReason("선생님과의 연결이 종료되었습니다.");
            setShowFallbackModal(true);
          },
          onFail: (err?: any) => {
            setFallbackReason(err?.message || "선생님 방을 찾을 수 없습니다. 방 번호를 다시 확인해 주세요.");
            setShowFallbackModal(true);
          },
          onKick: (reason: string) => {
            appAlert(reason || "방장에 의해 내보내졌습니다.");
            router.push("/?view=lobby");
          },
        });
        setActiveGuestRoom(newGuest);
        newGuest.connect();
      } else {
        const existingGuest: any = guest;
        if (existingGuest.hasJoined) {
          const resolvedId = existingGuest.peer?.id || storedNick;
          setMyId(resolvedId);
          setPlayers([
            {
              id: resolvedId,
              nickname: existingGuest.nickname || storedNick,
              student_number: "00",
              score: myScore,
              bonus_score: myBonusScore,
              ticket_count: myTickets.length,
              tickets: myTickets,
            },
          ]);
        }
        existingGuest.updateCallbacks({
          onBoard: (data: any) => {
            if (!data) return;
            const incomingMode = data.mode || data.gameState?.mode;
            if (incomingMode) {
              setGameMode(incomingMode);
              gameModeRef.current = incomingMode;
            }
            if (data.status) setRoomStatusRaw(data.status);
            if (data.gameState) {
              const gs = data.gameState;
              if (gs.game_session !== undefined) {
                setGameSession(gs.game_session);
                gameSessionRef.current = gs.game_session;
              }
              if (gs.current_round !== undefined) {
                setCurrentRound((prev) => {
                  if (prev !== gs.current_round) {
                    setHasSubmittedThisRound(false);
                    setMySelectedOption(null);
                  }
                  return gs.current_round;
                });
              }
              if (gs.round_status !== undefined) setRoundStatus(gs.round_status);
              if (gs.winning_numbers !== undefined) {
                setWinningNumbers((prev) => {
                  const prevKey = (prev || []).join(",");
                  const newKey = (gs.winning_numbers || []).join(",");
                  return prevKey !== newKey ? gs.winning_numbers : prev;
                });
              }
              if (gs.draw_revealed_count !== undefined) {
                setDrawRevealedCount(gs.draw_revealed_count);
              }
            }
            if (data.players) {
              setPlayers(data.players);
              const resolvedId = existingGuest.peer?.id || myId;
              const me = data.players.find((p: any) => p.id === resolvedId);
              if (me) {
                if (me.score !== undefined) setMyScore(me.score);
                if (me.bonus_score !== undefined) setMyBonusScore(me.bonus_score);
                if (me.tickets !== undefined) setMyTickets(me.tickets);
                if (me.selectedAnswer && currentQuizRef.current) {
                  const matched = currentQuizRef.current.options.find((o: any) => o.id === me.selectedAnswer);
                  if (matched) {
                    setMySelectedOption(matched);
                  }
                }
              }
            }
          },
          onStart: (data: any) => {
            clearSubmitCache(roomCode);
            if (data?.mode) {
              setGameMode(data.mode);
              gameModeRef.current = data.mode;
            }
            if (data?.game_session) {
              setGameSession(data.game_session);
              gameSessionRef.current = data.game_session;
            }
            const meta = parseStatusMeta(roomStatusRawRef.current);
            const tR = data?.total_rounds || meta.totalRounds;
            const diff = data?.difficulty || meta.difficulty;
            const rat = data?.ratio || meta.ratio;
            setRoomStatusRaw(`playing:${tR}:${diff}:${rat}`);
            setCurrentRound(data?.current_round || 1);
            setRoundStatus(data?.round_status || "show_question");
          },
          onEnd: (data: any) => {
            const meta = parseStatusMeta(roomStatusRawRef.current);
            const tR = data?.total_rounds || meta.totalRounds;
            const diff = data?.difficulty || meta.difficulty;
            const rat = data?.ratio || meta.ratio;
            setRoomStatusRaw(`finished:${tR}:${diff}:${rat}`);
          },
          onMessage: (payload: any) => {
            if (payload?.type === "event" && payload?.data?.name === "RESET_ROOM") {
              if (payload?.data?.game_session) {
                setGameSession(payload.data.game_session);
                gameSessionRef.current = payload.data.game_session;
              }
              clearSubmitCache(roomCode);
              const meta = parseStatusMeta(roomStatusRawRef.current);
              setRoomStatusRaw(`waiting:${meta.totalRounds}:${meta.difficulty}:${meta.ratio}`);
              setCurrentRound(1);
              setRoundStatus("show_question");
              setWinningNumbers([]);
              setDrawRevealedCount(0);
              setMyScore(0);
              setMyBonusScore(0);
              setMyTickets([]);
              setHasSubmittedThisRound(false);
              setMySelectedOption(null);
            }
          },
          onHostLost: () => {
            setFallbackReason("선생님과의 연결이 종료되었습니다.");
            setShowFallbackModal(true);
          },
          onFail: (err?: any) => {
            setFallbackReason(err?.message || "선생님 방을 찾을 수 없습니다. 방 번호를 다시 확인해 주세요.");
            setShowFallbackModal(true);
          },
        });
      }
    }
  }, [roomCode, router]);

  // --- 1-2. 학생 전용 제출 답안 복구 및 동기화 루프 (새로고침/튕김 대응 캐시) ---
  useEffect(() => {
    const activeRoomId = dbRoomId || roomCode;
    if (role !== "player" || !activeRoomId || !currentRound) return;

    if (typeof window !== "undefined") {
      const cacheKey = `luckypang_submit_room_${activeRoomId}_round_${currentRound}`;
      const cached = localStorage.getItem(cacheKey);
      if (cached) {
        try {
          const parsed = JSON.parse(cached);
          if (parsed && parsed.option) {
            setMySelectedOption(parsed.option);
            setHasSubmittedThisRound(true);
            return;
          }
        } catch (e) {
          console.error("제출 캐시 복구 실패", e);
        }
      }
    }
  }, [role, dbRoomId, roomCode, currentRound]);

  // --- 1-3. 학생용 실시간 출제 퀴즈 동기화 루프 (선언적 동기화) ---
  useEffect(() => {
    if (role !== "player" || !currentRound || !roundStatus) return;

    // 라운드 진행 중이고 질문 표시 단계일 때 최신 설정값을 반영하여 퀴즈 생성 (회차 번호 gameSession 포함)
    if (roundStatus === "show_question") {
      const sessionCode = `${roomCode}_s${gameSession}`;
      setCurrentQuiz(generateQuizForRound(currentRound, totalRounds, roomDifficulty, roomRatio, sessionCode));
    }
  }, [role, currentRound, totalRounds, roomDifficulty, roomRatio, roundStatus, roomCode, gameSession]);

  // --- 1-4. 학생 전용 방장 튕김 감지 및 3분 대기 타이머 루프 ---
  useEffect(() => {
    if (role !== "player" || !dbRoomId || !roomStatus) return;

    // 1. 방장이 의도적으로 방을 폐쇄했거나 완전히 폭파한 경우 즉시 강제 퇴장
    if (roomStatus === "closed") {
      appAlert("방장이 방을 종료하여 대기실 로비로 이동합니다.");
      router.push("/?view=lobby");
      return;
    }

    // 2. 방장 접속이 일시 유실된 경우 (host_disconnected:상태)
    if (roomStatus.startsWith("host_disconnected")) {
      if (hostDisconnectTimer === null) {
        setHostDisconnectTimer(180); // 3분 대기 시작
      }
    } else {
      // 방장이 복귀하여 정상 상태가 됨
      setHostDisconnectTimer(null);
    }
  }, [role, dbRoomId, roomStatus]);

  // 3분 카운트다운 루프
  useEffect(() => {
    if (hostDisconnectTimer === null) return;

    if (hostDisconnectTimer <= 0) {
      appAlert("선생님의 대기 시간이 초과되어 대기실 로비로 이동합니다.");
      router.push("/?view=lobby");
      return;
    }

    const interval = setInterval(() => {
      setHostDisconnectTimer((prev) => (prev !== null ? prev - 1 : null));
    }, 1000);

    return () => {
      clearInterval(interval);
    };
  }, [hostDisconnectTimer]);

  // --- 1-3. 책갈피 목록 복원 루프 (새로고침 대응) ---
  useEffect(() => {
    if (typeof window !== "undefined" && dbRoomId) {
      const cacheKey = `luckypang_bookmarks_room_${dbRoomId}`;
      const cached = localStorage.getItem(cacheKey);
      if (cached) {
        try {
          setBookmarkedQuizzes(JSON.parse(cached));
        } catch (e) {
          console.error("Failed to parse bookmarks", e);
        }
      }
    }
  }, [dbRoomId]);

  // 학생 본인의 최신 점수 및 티켓 동기화 (교사 board.players 기반으로 100% 일원화)
  useEffect(() => {
    if (role === "player" && dbPlayerId && players.length > 0) {
      const me = players.find((p) => p.id === dbPlayerId);
      if (me) {
        if (me.score !== undefined) setMyScore(me.score);
        if (me.tickets !== undefined) setMyTickets(me.tickets || []);
        if (me.bonus_score !== undefined) setMyBonusScore(me.bonus_score);
      }
    }
  }, [players, role, dbPlayerId]);

  // 학생용 라운드별 정오답 결과 자동 누적 및 대기실 컴백 초기화 훅
  useEffect(() => {
    if (role === "player") {
      if (roomStatus === "waiting") {
        // 대기실로 복귀하면 정오답 누적 내역 일괄 초기화
        setMyRoundResults([]);
      } else if (roomStatus === "playing" && roundStatus === "show_answer" && currentRound > 0) {
        // 채점 정답 공개 시점에 본인이 최종 제출한 정오답 여부 적재 (중복 방지 가드 작동)
        setMyRoundResults((prev) => {
          if (prev.some((r) => r.round === currentRound)) return prev;
          const isCorrect = mySelectedOption ? mySelectedOption.isCorrect : false;
          return [...prev, { round: currentRound, isCorrect }];
        });
      }
    }
  }, [role, roomStatus, roundStatus, currentRound, mySelectedOption]);

  // --- 2. 로컬 가상 봇 실시간 시뮬레이션 동작 루프 (isLocalSim === true 일 때) ---
  useEffect(() => {
    if (!isLocalSim || role !== "host" || roomStatus !== "playing") return;

    // 봇들이 각 라운드마다 문제를 푸는 시뮬레이션
    let botTimers: NodeJS.Timeout[] = [];

    // 매 라운드가 시작될 때마다 봇들이 2~6초 사이에 비동기 제출
    bots.forEach((bot) => {
      const delay = 1500 + Math.random() * 4000; // 1.5초~5.5초
      const timer = setTimeout(() => {
        // 문제 풀이 시뮬레이션
        const currentRoundQuiz = generateQuizForRound(currentRound, totalRounds, roomDifficulty, roomRatio, roomCodeRef.current);
        // 무작위로 선택지 고름 (정답/오답/폭탄)
        const chosenOption = currentRoundQuiz.options[Math.floor(Math.random() * 5)];

        let scoreGain = 0;
        let lottoTicket: number[] | null = null;

        if (chosenOption.isCorrect) {
          if (chosenOption.isLotto) {
            scoreGain = 300; // 로또 대박 정답은 +300점
            lottoTicket = generateLottoNumbers();
          } else {
            scoreGain = 100; // 일반 정답은 +100점
          }
        } else if (chosenOption.isBomb) {
          scoreGain = -100; // 감점
        }

        setBots((prevBots) =>
          prevBots.map((b) => {
            if (b.id === bot.id) {
              const updatedTickets = lottoTicket ? [...b.tickets, { numbers: lottoTicket }] : b.tickets;
              return {
                ...b,
                score: Math.max(0, b.score + scoreGain),
                ticket_count: updatedTickets.length,
                tickets: updatedTickets,
              };
            }
            return b;
          })
        );
      }, delay);
      botTimers.push(timer);
    });

    return () => {
      botTimers.forEach((t) => clearTimeout(t));
    };
  }, [isLocalSim, roomStatus, currentRound, role, totalRounds, roomDifficulty, roomRatio, roomCode]);

  // --- 3. 로컬 시뮬레이터 교사용 문제 캐싱 및 로컬스토리지 동기화 ---
  useEffect(() => {
    if (role === "host") {
      const sessionCode = `${displayRoomCode || roomCode}_s${gameSession}`;
      const quiz = generateQuizForRound(currentRound, totalRounds, roomDifficulty, roomRatio, sessionCode);
      setQuizForRound(quiz);
      if (typeof window !== "undefined") {
        localStorage.setItem("luckypang_current_quiz", JSON.stringify(quiz));
      }
    }
  }, [currentRound, role, totalRounds, roomDifficulty, roomRatio, roomCode, displayRoomCode, gameSession]);

  // --- 4. 호스트(교사) 제어 함수 리스트 (PeerJS 기반) ---

  // 게임 시작하기
  const handleStartGame = async () => {
    clearSubmitCache(roomCode);
    pendingAnswersRef.current = {};

    const playStatus = `playing:${totalRounds}:${roomDifficulty}:${roomRatio}`;
    setRoomStatusRaw(playStatus);
    setCurrentRound(1);
    setRoundStatus("show_question");

    const host = getActiveHostRoom();
    if (host) {
      host.start({
        current_round: 1,
        round_status: "show_question",
        total_rounds: totalRounds,
        difficulty: roomDifficulty,
        ratio: roomRatio,
        mode: gameModeRef.current,
        game_session: gameSessionRef.current,
      });
      host.sendBoard({
        status: playStatus,
        mode: gameModeRef.current,
        gameState: {
          mode: gameModeRef.current,
          game_session: gameSessionRef.current,
          current_round: 1,
          total_rounds: totalRounds,
          round_status: "show_question",
          winning_numbers: [],
        },
        players: playersRef.current,
      });
    }
  };

  // 정답 및 해설 공개하기 (이 시점에 저장된 답안을 일괄 채점하여 점수 반영 및 board 브로드캐스트)
  const handleRevealAnswer = async () => {
    if (isPendingHostAction) return;
    setIsPendingHostAction(true);

    setRoundStatus("show_answer");
    roundStatusRef.current = "show_answer";

    try {
      const r = currentRoundRef.current;
      const quiz = generateQuizForRound(
        r,
        totalRoundsRef.current,
        roomDifficultyRef.current,
        roomRatioRef.current,
        roomCodeRef.current
      );
      const roundAnswers = pendingAnswersRef.current[r] || {};

      const updatedPlayers = playersRef.current.map((p) => {
        const optionId = roundAnswers[p.id];
        if (!optionId) {
          return {
            ...p,
            selectedAnswer: null,
            isCorrect: false,
            isLotto: false,
            isBomb: false,
          };
        }

        const selectedOpt = quiz.options.find((o) => o.id === optionId);
        if (!selectedOpt) {
          return {
            ...p,
            selectedAnswer: optionId,
            isCorrect: false,
            isLotto: false,
            isBomb: false,
          };
        }

        let scoreGain = 0;
        let newTicketNums: number[] | null = null;

        if (selectedOpt.isCorrect) {
          if (selectedOpt.isLotto) {
            scoreGain = 300;
            // [티켓 발급 규칙] 익스트림 모드일 때만 티켓 발급 (기본 모드는 +300점만)
            if (gameModeRef.current === "extreme") {
              newTicketNums = generateLottoNumbers();
            }
          } else {
            scoreGain = 100;
          }
        } else if (selectedOpt.isBomb) {
          scoreGain = -100;
        }

        const newScore = Math.max(0, (p.score || 0) + scoreGain);
        const newTickets = newTicketNums
          ? [...(p.tickets || []), { numbers: newTicketNums }]
          : p.tickets || [];

        return {
          ...p,
          score: newScore,
          tickets: newTickets,
          ticket_count: newTickets.length,
          selectedAnswer: optionId,
          isCorrect: selectedOpt.isCorrect,
          isLotto: selectedOpt.isLotto,
          isBomb: selectedOpt.isBomb,
        };
      });

      setPlayers(updatedPlayers);
      playersRef.current = updatedPlayers;

      const host = getActiveHostRoom();
      if (host) {
        host.sendBoard({
          status: roomStatusRawRef.current,
          mode: gameModeRef.current,
          gameState: {
            mode: gameModeRef.current,
            current_round: currentRoundRef.current,
            total_rounds: totalRounds,
            round_status: "show_answer",
            winning_numbers: winningNumbersRef.current,
          },
          players: updatedPlayers,
        });
      }
    } catch (e) {
      console.error("Failed to reveal answer:", e);
    } finally {
      setIsPendingHostAction(false);
    }
  };

  // 다음 라운드 넘어가기
  const handleNextRound = async () => {
    if (isPendingHostAction) return;
    setIsPendingHostAction(true);

    try {
      const host = getActiveHostRoom();
      if (currentRound >= totalRounds) {
        const nextStatus = mode === "extreme" ? "drawing" : "finished";
        const statusMeta = `${nextStatus}:${totalRounds}:${roomDifficulty}:${roomRatio}`;
        setRoomStatusRaw(statusMeta);

        if (nextStatus === "drawing") {
          setWinningNumbers([]);
          winningNumbersRef.current = [];
          setDrawRevealedCount(0);
          drawRevealedCountRef.current = 0;
        }

        if (host) {
          if (nextStatus === "finished") {
            host.end({ status: "finished" });
          }
          host.sendBoard({
            status: statusMeta,
            mode: gameModeRef.current,
            gameState: {
              mode: gameModeRef.current,
              current_round: currentRoundRef.current,
              total_rounds: totalRounds,
              round_status: "round_result",
              winning_numbers: nextStatus === "drawing" ? [] : winningNumbersRef.current,
              draw_revealed_count: 0,
            },
            players: playersRef.current,
          });
        }
      } else {
        const nextR = currentRound + 1;
        setCurrentRound(nextR);
        setRoundStatus("show_question");

        if (host) {
          host.sendBoard({
            status: roomStatusRawRef.current,
            mode: gameModeRef.current,
            gameState: {
              mode: gameModeRef.current,
              current_round: nextR,
              total_rounds: totalRounds,
              round_status: "show_question",
              winning_numbers: winningNumbersRef.current,
              draw_revealed_count: drawRevealedCountRef.current,
            },
            players: playersRef.current,
          });
        }
      }
    } catch (e) {
      console.error("Failed to transition to next round:", e);
    } finally {
      setIsPendingHostAction(false);
    }
  };

  // 교사용 실시간 추첨 공개 개수 브로드캐스트 핸들러
  const handleRevealedCountChange = (count: number) => {
    setDrawRevealedCount(count);
    drawRevealedCountRef.current = count;
    const host = getActiveHostRoom();
    if (host) {
      host.sendBoard({
        status: roomStatusRawRef.current,
        mode: gameModeRef.current,
        gameState: {
          mode: gameModeRef.current,
          current_round: currentRoundRef.current,
          total_rounds: totalRounds,
          round_status: roundStatusRef.current,
          winning_numbers: winningNumbersRef.current,
          draw_revealed_count: count,
        },
        players: playersRef.current,
      });
    }
  };

  // 익스트림 모드 당첨 번호 추첨하기
  const handleDrawNumbers = async () => {
    if (isPendingHostAction) return;
    setIsPendingHostAction(true);
    const finalLotto = generateLottoNumbers();

    try {
      setWinningNumbers(finalLotto);
      setDrawRevealedCount(0);
      drawRevealedCountRef.current = 0;
      const drawingStatus = `drawing:${totalRounds}:${roomDifficulty}:${roomRatio}`;
      setRoomStatusRaw(drawingStatus);

      const host = getActiveHostRoom();
      if (host) {
        host.sendBoard({
          status: drawingStatus,
          mode: gameModeRef.current,
          gameState: {
            mode: gameModeRef.current,
            current_round: currentRoundRef.current,
            total_rounds: totalRounds,
            round_status: roundStatusRef.current,
            winning_numbers: finalLotto,
            draw_revealed_count: 0,
          },
          players: playersRef.current,
        });
      }

      if (isLocalSim) {
        setTimeout(async () => {
          setBots((prevBots) =>
            prevBots.map((b) => {
              let bonus = 0;
              b.tickets.forEach((ticket: any) => {
                const matched = ticket.numbers.filter((num: number) => finalLotto.includes(num));
                if (matched.length === 2) bonus += 50;
                else if (matched.length === 3) bonus += 200;
                else if (matched.length === 4) bonus += 500;
                else if (matched.length === 5) bonus += 1500;
                else if (matched.length === 6) bonus += 5000;
              });
              return {
                ...b,
                bonus_score: bonus,
              };
            })
          );
          await updateRoomStatusWithMeta("finished");
        }, 9500);
      }
    } catch (e) {
      console.error("Failed to draw numbers:", e);
    } finally {
      setIsPendingHostAction(false);
    }
  };

  // 교사용 게임 최종 종료
  const handleFinishGame = async () => {
    if (isPendingHostAction) return;
    setIsPendingHostAction(true);
    try {
      // 익스트림 모드인 경우, 학생의 FINISH_DRAW 수신 여부와 상관없이 교사가 calculateTicketBonus로 전원 보너스 확정 정산
      let finalPlayers = playersRef.current;
      if (gameModeRef.current === "extreme") {
        const sessionRoomCode = roomCodeRef.current;
        finalPlayers = playersRef.current.map((p) => {
          const rawTickets = p.tickets || [];
          const bonus = calculateTicketBonus(sessionRoomCode, rawTickets);
          return {
            ...p,
            bonus_score: bonus,
          };
        });
        setPlayers(finalPlayers);
        playersRef.current = finalPlayers;
      }

      const finishStatus = `finished:${totalRounds}:${roomDifficulty}:${roomRatio}`;
      setRoomStatusRaw(finishStatus);
      const host = getActiveHostRoom();
      if (host) {
        host.end({ status: "finished" });
        host.sendBoard({
          status: finishStatus,
          mode: gameModeRef.current,
          gameState: {
            mode: gameModeRef.current,
            game_session: gameSessionRef.current,
            current_round: currentRoundRef.current,
            total_rounds: totalRounds,
            round_status: roundStatusRef.current,
            winning_numbers: winningNumbersRef.current,
          },
          players: finalPlayers,
        });
      }
    } catch (e) {
      console.error("Failed to finish game:", e);
    } finally {
      setIsPendingHostAction(false);
    }
  };

  // 교사(방장) - 대기실로 돌아가서 한 판 더 하기 핸들러
  const handleResetToWaiting = async () => {
    if (isPendingHostAction) return;
    if (!await appConfirm("대기실로 돌아가시겠습니까?\n모든 학생의 점수와 티켓이 초기화되며 새로 한 판 더 진행합니다.")) return;

    setIsPendingHostAction(true);
    try {
      // 게임 회차 번호 1 증가 (문제 및 미션 시드 다양화)
      const nextSession = gameSessionRef.current + 1;
      setGameSession(nextSession);
      gameSessionRef.current = nextSession;
      const baseCode = displayRoomCode || roomCode;
      roomCodeRef.current = `${baseCode}_s${nextSession}`;

      clearSubmitCache(roomCode);
      const waitingStatus = `waiting:${totalRounds}:${roomDifficulty}:${roomRatio}`;
      setRoomStatusRaw(waitingStatus);
      setCurrentRound(1);
      setRoundStatus("show_question");
      setWinningNumbers([]);
      setMyScore(0);
      setMyBonusScore(0);
      setMyTickets([]);
      pendingAnswersRef.current = {};

      const resetPlayers = playersRef.current.map((p) => ({
        ...p,
        score: 0,
        bonus_score: 0,
        ticket_count: 0,
        tickets: [],
        selectedAnswer: null,
        isCorrect: false,
        isLotto: false,
        isBomb: false,
      }));
      setPlayers(resetPlayers);

      const host = getActiveHostRoom();
      if (host) {
        host.broadcast("event", { name: "RESET_ROOM", game_session: nextSession });
        host.sendBoard({
          status: waitingStatus,
          mode: gameModeRef.current,
          gameState: {
            mode: gameModeRef.current,
            game_session: nextSession,
            current_round: 1,
            total_rounds: totalRounds,
            round_status: "show_question",
            winning_numbers: [],
          },
          players: resetPlayers,
        });
      }
    } catch (e) {
      console.error("Failed to reset room to waiting:", e);
      appAlert("대기실로 돌아가는 중 오류가 발생했습니다.");
    } finally {
      setIsPendingHostAction(false);
    }
  };

  // 교사(방장)의 의도적 나가기 핸들러
  const handleHostExit = async () => {
    if (await appConfirm("🚨 주의: 모든 학생의 게임이 즉시 종료됩니다!\n\n선생님이 나가시면 참여 중인 모든 학생의 접속이 끊어지고 방이 사라집니다.\n정말 방을 종료하고 나가시겠습니까?")) {
      isExitingRef.current = true;
      const host = getActiveHostRoom();
      if (host) {
        try {
          host.end({ reason: "선생님이 방을 종료했습니다." });
        } catch (e) {
          console.error(e);
        }
        setTimeout(() => {
          host.destroy();
        }, 300);
      }
      if (typeof window !== "undefined") {
        localStorage.removeItem("luckypang_host_active_room");
        sessionStorage.removeItem("luckypang_host_tab_session");
      }
      router.push("/?view=lobby");
    }
  };

  // 교사(방장)가 게임 완료 후 방을 완전히 닫고 로비로 나가는 퇴장 핸들러
  const handleHostTerminate = async () => {
    await handleHostExit();
  };

  // 교사(방장) 활동 시간(lastActiveAt) 자동 갱신 (수업 중 방 자동 만료 완전 방지)
  useEffect(() => {
    if (typeof window !== "undefined" && isHost && dbRoomId) {
      const updateActiveTime = () => {
        const cached = localStorage.getItem("luckypang_host_active_room");
        if (cached) {
          try {
            const obj = JSON.parse(cached);
            if (obj.id === dbRoomId) {
              localStorage.setItem(
                "luckypang_host_active_room",
                JSON.stringify({ ...obj, lastActiveAt: Date.now() })
              );
            }
          } catch (e) {
            console.error(e);
          }
        }
      };

      updateActiveTime();
      const activeTimer = setInterval(updateActiveTime, 3 * 60 * 1000);
      return () => clearInterval(activeTimer);
    }
  }, [isHost, dbRoomId]);

  // --- 5. 학생 플레이어 액션 핸들러 (PeerJS 기반) ---
  const handleSelectOption = async (option: QuizOption) => {
    setHasSubmittedThisRound(true);
    setMySelectedOption(option);

    // 로컬 스토리지에 제출 결과 임시 백업 (새로고침/튕김 복구 대비)
    const activeRoomId = displayRoomCode || roomCode;
    if (typeof window !== "undefined" && activeRoomId && currentRound) {
      const cacheKey = `luckypang_submit_room_${activeRoomId}_round_${currentRound}`;
      localStorage.setItem(cacheKey, JSON.stringify({
        option: option,
        submitted: true
      }));
    }

    // PeerJS: 채점과 티켓 추첨은 교사 브라우저가 전담하므로 학생은 답안 이벤트만 전송!
    const guest = getActiveGuestRoom();
    if (guest) {
      guest.sendEvent("SUBMIT_ANSWER", {
        round: currentRound,
        optionId: option.id,
      });
    }
  };

  // 학생 당첨 번호 추첨 완료 및 보너스 적용
  const handleFinishDraw = async (bonus: number) => {
    // 로컬 화면 피드백을 위한 즉시 반영
    setMyBonusScore(bonus);

    // 교사에게 추첨 완료 알림 (실제 보너스 점수는 교사가 tickets와 당첨번호로 직접 계산하여 board로 확정 방송)
    const guest = getActiveGuestRoom();
    if (guest) {
      guest.sendEvent("FINISH_DRAW", { finished: true });
    }

    // 학생 브라우저 로컬 스토리지에 본인 경기 기록 영구 보존 (Local-First)
    saveLuckyRecord({
      roomCode: displayRoomCode || roomCode,
      score: myScore,
      bonusScore: bonus,
      mode: mode,
    });

    // 최종 결과 정산 모달 띄우기
    setShowResultModal(true);
  };

  // 학생 플레이어 직접 방 나가기
  const handleStudentExit = async () => {
    if (await appConfirm("정말 방에서 나가시겠습니까?")) {
      isExitingRef.current = true;
      const guest = getActiveGuestRoom();
      if (guest) {
        try {
          guest.sendEvent("LEAVE", { peerId: myId });
        } catch (e) {
          console.error(e);
        }
        guest.destroy();
      }
      if (typeof window !== "undefined") {
        sessionStorage.removeItem("luckypang_player_tab_session");
      }
      router.push("/?view=lobby");
    }
  };

  // --- 6. 스코어보드 리스트 생성 (실제 플레이어 + 봇 병합) ---
  const scoreboardList = useMemo(() => {
    const list = isLocalSim ? bots : players;
    return [...list].sort((a, b) => {
      const totalA = (a.score || 0) + (a.bonus_score || 0);
      const totalB = (b.score || 0) + (b.bonus_score || 0);
      return totalB - totalA;
    });
  }, [isLocalSim, players, bots]);

  // 교사(호스트) 대시보드용 보기 캐싱 (이미 시드 기반 셔플 완료된 options 그대로 활용)
  const currentHostOptions = useMemo(() => {
    if (!quizForRound) return [];
    return quizForRound.options;
  }, [quizForRound]);

  // --- 7. 교사용 (호스트) 뷰 렌더링 ---
  if (role === "host") {
    return (
      <div className="flex flex-col min-h-screen bg-cream px-6 py-8">
        {/* 상단 헤더 — 좌: 타이틀, 중: 배지들, 우: 나가기 버튼 */}
        <div className="w-full flex flex-wrap items-center bg-white border-4 border-black rounded-3xl px-6 py-4 mb-6 shadow-[6px_6px_0px_0px_rgba(0,0,0,1)] gap-4">
          {/* 왼쪽: 대시보드 타이틀 */}
          <div className="flex items-center gap-4 shrink-0">
            <span className="text-4xl md:text-5xl shrink-0 select-none">🧑‍🏫</span>
            <div className="text-left">
              <h2 className="text-2xl md:text-3xl font-black text-black tracking-tight">
                선생님 대시보드
              </h2>
              <p className="text-xs md:text-sm font-bold text-gray-500 mt-0.5">
                {isLocalSim ? "💡 로컬 시뮬레이터 데모 구동 중" : "📡 실시간 서버 연동 중"}
              </p>
            </div>
          </div>

          {/* 중간: 정답확인 / 방번호 / 모드 / 참가자 배지들 */}
          <div className="flex flex-wrap gap-3 items-center flex-1 justify-start">
            <button
              onClick={() => {
                if (typeof window !== "undefined") {
                  window.open(
                    `/room/${displayRoomCode || roomCode}/answer-key?mode=${mode}`,
                    "luckypang_answer_key",
                    "width=650,height=750,scrollbars=yes,resizable=yes"
                  );
                }
              }}
              className="bg-pink border-2 border-black rounded-xl px-4 py-2.5 text-base md:text-lg font-black text-red-900 shadow-[3px_3px_0px_0px_rgba(0,0,0,1)] hover:-translate-y-0.5 hover:shadow-[5px_5px_0px_0px_rgba(0,0,0,1)] transition-all cursor-pointer select-none shrink-0"
            >
              🔑 정답 팝업(교사용) 열기
            </button>
            <button
              onClick={handleCopyRoomCode}
              className="bg-lemon border-3 border-black rounded-xl px-4 py-2 text-black shadow-[3px_3px_0px_0px_rgba(0,0,0,1)] hover:-translate-y-0.5 hover:shadow-[4px_4px_0px_0px_rgba(0,0,0,1)] transition-all cursor-pointer select-none shrink-0 flex items-center gap-2 whitespace-nowrap"
              title="클릭하여 방 번호 복사"
            >
              <span className="text-xs md:text-sm font-extrabold text-gray-700">방 번호:</span>
              <span className="font-['Noto_Sans_KR',sans-serif] text-xl md:text-2xl font-black text-indigo-700 tracking-wider leading-none">
                {displayRoomCode || roomCode}
              </span>
              <span className="text-xs">{copied ? "✅" : "📋"}</span>
            </button>
            <button
              onClick={() => copyToClipboard(inviteLink, "초대 링크가 복사되었습니다! 🔗")}
              title="초대 링크 복사"
              className="bg-white border-2 border-black rounded-xl px-4 py-2.5 text-base md:text-lg font-black text-black shadow-[3px_3px_0px_0px_rgba(0,0,0,1)] hover:-translate-y-0.5 hover:shadow-[4px_4px_0px_0px_rgba(0,0,0,1)] transition-all cursor-pointer select-none shrink-0 flex items-center gap-2"
            >
              <span>🔗 링크 복사</span>
            </button>
            <button
              onClick={() => setShowQrModal(true)}
              title="QR코드 보기"
              className="bg-white border-2 border-black rounded-xl px-4 py-2.5 text-base md:text-lg font-black text-black shadow-[3px_3px_0px_0px_rgba(0,0,0,1)] hover:-translate-y-0.5 hover:shadow-[4px_4px_0px_0px_rgba(0,0,0,1)] transition-all cursor-pointer select-none shrink-0 flex items-center gap-2"
            >
              <span>📱 QR코드</span>
            </button>
            <span className="bg-sky border-2 border-black rounded-xl px-4 py-2.5 text-base md:text-lg font-black text-black shadow-[3px_3px_0px_0px_rgba(0,0,0,1)] shrink-0">
              모드: {mode === "extreme" ? "🔥 익스트림" : "✔️ 기본"}
            </span>
            <button
              onClick={() => setShowPlayersModal(true)}
              className="bg-white border-2 border-black rounded-xl px-4 py-2.5 text-base md:text-lg font-black text-black shadow-[3px_3px_0px_0px_rgba(0,0,0,1)] hover:-translate-y-0.5 hover:shadow-[4px_4px_0px_0px_rgba(0,0,0,1)] transition-all cursor-pointer select-none shrink-0"
              title="클릭하여 참가자 명단 보기"
            >
              👥 참가자: {scoreboardList.length}명
            </button>
          </div>

          {/* 오른쪽: 나가기 버튼 */}
          <button
            onClick={handleHostExit}
            className="bg-white border-2 border-black rounded-xl px-5 py-2.5 text-base md:text-lg font-black text-black shadow-[3px_3px_0px_0px_rgba(0,0,0,1)] hover:-translate-y-0.5 hover:shadow-[5px_5px_0px_0px_rgba(0,0,0,1)] transition-all cursor-pointer select-none shrink-0"
          >
            🚪 나가기
          </button>
        </div>

        {/* 교사 탭 유지 필수 안내 배너 (상시 노출) */}
        <div className="w-full bg-amber-50 border-3 border-black rounded-2xl px-4 py-2.5 mb-5 shadow-[3px_3px_0px_0px_rgba(0,0,0,1)] flex items-center justify-between gap-3 text-xs md:text-sm font-black text-amber-950">
          <div className="flex items-center gap-2">
            <span className="text-base animate-pulse">⚠️</span>
            <span>새로고침 또는 창 종료 시 게임이 종료됩니다. 본 게임이 완전히 끝날 때까지 브라우저 창을 유지해 주세요.</span>
          </div>
          <span className="hidden sm:inline-block bg-white border border-black px-2.5 py-0.5 rounded-full text-[11px] font-black text-amber-900 shrink-0">
            🔒 창 유지 필수
          </span>
        </div>

        {/* 메인 레이아웃 분할 */}
        <div className="flex-1 w-full flex flex-col lg:flex-row gap-6 items-stretch">

          {/* 좌측: 게임 진행 상태 및 연출 패널 */}
          <div className="flex-2 bg-white neo-box p-6 flex flex-col items-center justify-center text-center min-h-[400px]">
            {roomStatus === "waiting" && (
              <div className="flex flex-col items-center w-full max-w-4xl">
                {isLocalSim && (
                  <p className="text-sm font-bold text-yellow-700 bg-yellow-50 px-4 py-1 border border-yellow-300 rounded-full mb-2 break-keep">
                    💡 로컬 시뮬레이터 모드에서는 가상 봇 4명이 자동으로 입장하여 시뮬레이션 대기 중입니다.
                  </p>
                )}

                {/* 교실 TV/프로젝터 최적화: 초대형 접속 방 번호 안내 카드 (교실 맨 뒤 학생 가독성 보장) */}
                <div className="w-full bg-[#FFF59D] border-4 border-black rounded-3xl p-5 md:p-6 mb-3 shadow-[4px_4px_0px_0px_rgba(0,0,0,1)] flex flex-col sm:flex-row items-center justify-between gap-4 text-center sm:text-left">
                  <div className="flex flex-col">
                    <span className="text-xs md:text-sm font-black text-slate-700 uppercase tracking-widest mb-1">
                      📢 학생 접속 방 번호 (교실 TV 안내)
                    </span>
                    <div className="flex items-center justify-center sm:justify-start gap-3">
                      <span className="font-['Noto_Sans_KR',sans-serif] text-4xl sm:text-5xl md:text-6xl font-black text-indigo-700 tracking-widest leading-none select-all">
                        {displayRoomCode || roomCode}
                      </span>
                    </div>
                  </div>
                  <div className="flex items-center gap-2.5 shrink-0">
                    <button
                      onClick={handleCopyRoomCode}
                      className="bg-white border-2 border-black rounded-xl px-4 py-2.5 text-sm md:text-base font-black hover:bg-slate-100 transition-all cursor-pointer shadow-[2px_2px_0px_0px_rgba(0,0,0,1)] shrink-0 flex items-center gap-1.5"
                    >
                      <span>{copied ? "✅ 복사됨" : "📋 번호 복사"}</span>
                    </button>
                    <button
                      onClick={() => setShowQrModal(true)}
                      className="bg-sky border-2 border-black rounded-xl px-4 py-2.5 text-sm md:text-base font-black hover:bg-sky/80 transition-all cursor-pointer shadow-[2px_2px_0px_0px_rgba(0,0,0,1)] shrink-0 flex items-center gap-1.5"
                    >
                      <span>📱 QR코드 열기</span>
                    </button>
                  </div>
                </div>

                {/* 대기실 전용: 교사용 실시간 퀴즈 설정판 (스크롤 방지 수직 압축 완료) */}
                <div className="w-full bg-cream border-4 border-black rounded-3xl p-5 md:p-6 my-4 shadow-[4px_4px_0px_0px_rgba(0,0,0,1)] text-left flex flex-col gap-4">
                  <span className="text-lg md:text-xl font-black text-gray-700 flex items-center gap-2 border-b-2 border-dashed border-gray-300 pb-2">
                    ⚙️ 실시간 퀴즈 환경 설정
                  </span>

                  {/* 1. 문제 수 단계 슬라이더 */}
                  <div className="flex flex-col gap-2 bg-white border-4 border-black rounded-2xl p-4 shadow-[1.5px_1.5px_0px_0px_rgba(0,0,0,1)]">
                    <div className="flex justify-between items-center w-full">
                      <span className="text-base md:text-lg font-black text-gray-700">📝 문제 수 설정</span>
                      <span className="bg-sky text-black border-2 border-black text-xs md:text-sm font-black px-3 py-0.5 rounded-lg shadow-[0.5px_0.5px_0px_rgba(0,0,0,1)] animate-pulse">
                        {totalRounds}문항
                      </span>
                    </div>
                    <div className="px-1 mt-1 w-full">
                      <input
                        type="range"
                        min="0"
                        max="4"
                        step="1"
                        value={ROUND_PRESETS.indexOf(totalRounds) !== -1 ? ROUND_PRESETS.indexOf(totalRounds) : 1}
                        onChange={(e) => {
                          const nextRounds = ROUND_PRESETS[parseInt(e.target.value)];
                          const statusMeta = `waiting:${nextRounds}:${roomDifficulty}:${roomRatio}`;
                          setRoomStatusRaw(statusMeta);
                          const host = getActiveHostRoom();
                          if (host) {
                            host.sendBoard({
                              status: statusMeta,
                              gameState: {
                                current_round: 1,
                                total_rounds: nextRounds,
                                round_status: "show_question",
                                winning_numbers: [],
                              },
                              players: playersRef.current,
                            });
                          }
                        }}
                        className="w-full h-2.5 bg-gray-200 rounded-lg appearance-none cursor-pointer accent-black border-2 border-black"
                      />
                      <div className="flex justify-between text-[10px] md:text-xs font-black text-gray-400 mt-1">
                        <span>6문항</span>
                        <span>12문항</span>
                        <span>18문항</span>
                        <span>24문항</span>
                        <span>30문항</span>
                      </div>
                    </div>
                  </div>

                  {/* 2. 문제 유형 선택 */}
                  <div className="flex flex-col gap-2.5 bg-white border-4 border-black rounded-2xl p-4 shadow-[1.5px_1.5px_0px_0px_rgba(0,0,0,1)]">
                    <span className="text-base md:text-lg font-black text-gray-700">🎯 문제 유형 선택</span>
                    <div className="grid grid-cols-4 gap-2 w-full">
                      {(["easy", "hard", "normal", "mix"] as const).map((diffOpt) => {
                        const label = diffOpt === "easy" ? "약수&배수 찾기" : diffOpt === "hard" ? "공약수&공배수" : diffOpt === "normal" ? "약수&배수 관계 및 성질" : "혼합";
                        return (
                          <button
                            key={diffOpt}
                            onClick={() => {
                              const statusMeta = `waiting:${totalRounds}:${diffOpt}:${diffOpt === "mix" ? "1:1:1" : "none"}`;
                              setRoomStatusRaw(statusMeta);
                              const host = getActiveHostRoom();
                              if (host) {
                                host.sendBoard({
                                  status: statusMeta,
                                  gameState: {
                                    current_round: 1,
                                    total_rounds: totalRounds,
                                    round_status: "show_question",
                                    winning_numbers: [],
                                  },
                                  players: playersRef.current,
                                });
                              }
                            }}
                            className={`py-2 text-base md:text-lg font-black rounded-xl border-2 border-black transition-all cursor-pointer ${roomDifficulty === diffOpt
                              ? "bg-sky shadow-[1.5px_1.5px_0px_0px_rgba(0,0,0,1)] scale-102"
                              : "bg-gray-55 text-gray-400"
                              }`}
                          >
                            {label}
                          </button>
                        );
                      })}
                    </div>

                    {/* 유형 설명 가이드 문구 */}
                    <div className="bg-gray-55 border-2 border-black rounded-xl p-3 mt-1 text-xs md:text-sm font-bold text-gray-600 leading-relaxed select-none">
                      {roomDifficulty === "easy" && "🟢 유형 1 (단순 약수·배수): 단순 약수와 배수를 직접 구하는 기초 연산 문제가 출제됩니다."}
                      {roomDifficulty === "hard" && "🔵 유형 2 (공약수·공배수): 공약수, 최대공약수, 공배수, 최소공배수를 직접 구하는 연산 문제가 출제됩니다."}
                      {roomDifficulty === "normal" && "🟡 유형 3 (관계 판정): 곱셈식 속 약수·배수 관계 및 최대공약수/최소공배수의 성질을 문장으로 판별하는 문제가 출제됩니다."}
                      {roomDifficulty === "mix" && `🟠 믹스 유형: 설정 비율(${roomRatio})에 맞추어 유형 1, 2, 3 문제를 섞어서 출제합니다.`}
                    </div>

                    {/* 믹스(Mix) 전용 혼합 비율 조절 단추 그룹 */}
                    {roomDifficulty === "mix" && (
                      <div className="mt-2 border-t-2 border-dashed border-gray-200 pt-2 flex flex-col gap-1.5 w-full">
                        <span className="text-[10px] md:text-xs font-black text-gray-500">
                          ⚖️ 유형 혼합 비율 (유형 1 : 유형 2 : 유형 3)
                        </span>
                        <div className="flex gap-1.5 w-full">
                          {(["1:1:1", "3:2:1", "1:2:3"] as const).map((ratioOpt) => (
                            <button
                              key={ratioOpt}
                              onClick={() => {
                                const statusMeta = `waiting:${totalRounds}:${roomDifficulty}:${ratioOpt}`;
                                setRoomStatusRaw(statusMeta);
                                const host = getActiveHostRoom();
                                if (host) {
                                  host.sendBoard({
                                    status: statusMeta,
                                    gameState: {
                                      current_round: 1,
                                      total_rounds: totalRounds,
                                      round_status: "show_question",
                                      winning_numbers: [],
                                    },
                                    players: playersRef.current,
                                  });
                                }
                              }}
                              className={`flex-1 py-1.5 text-xs md:text-sm font-black rounded-lg border-2 border-black transition-all cursor-pointer ${roomRatio === ratioOpt
                                ? "bg-lemon shadow-[1.5px_1.5px_0px_0px_rgba(0,0,0,1)] scale-102"
                                : "bg-gray-55 text-gray-400"
                                }`}
                            >
                              {ratioOpt}
                            </button>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                </div>

                <button
                  onClick={handleStartGame}
                  className="px-10 py-3.5 bg-lemon text-black font-black text-xl neo-btn shadow-[3.5px_3.5px_0px_rgba(0,0,0,1)] mt-3"
                >
                  🚀 게임 시작하기
                </button>

                <p className="text-xs font-bold text-gray-500 mt-3 flex items-center justify-center gap-1.5">
                  <span>💡</span>
                  <span>새로고침 또는 창 종료 시 게임이 종료됩니다. 본 게임이 완전히 끝날 때까지 브라우저 창을 유지해 주세요.</span>
                </p>
              </div>
            )}

            {roomStatus === "playing" && (
              <div className="w-full flex flex-col items-center">

                {/* ROUND 표시 배지 — 문제 영역 상단 */}
                <div className="bg-lemon border-2 border-black rounded-full px-10 py-2 text-xl md:text-2xl font-black text-black shadow-[3px_3px_0px_0px_rgba(0,0,0,1)] mb-5 animate-pulse">
                  🎯 ROUND {currentRound} / {totalRounds}
                </div>

                {/* 현재 출제된 문제 요약 & 선택지 현황 */}
                {quizForRound && (
                  <div className="w-full max-w-2xl flex flex-col items-center gap-4 mb-6">
                    <div className="bg-cream border-2 border-black rounded-2xl p-6 w-full shadow-[3px_3px_0px_0px_rgba(0,0,0,1)]">
                      <p className="text-xs font-black text-gray-500 mb-1">CURRENT QUESTION</p>
                      <h4 className="text-xl md:text-2xl font-bold text-black break-keep leading-relaxed">
                        {quizForRound.question_text}
                      </h4>
                    </div>

                    {/* 교사 화면용 선택지 카드 목록 (show_answer 단계일 때만 정답 속성 배지 노출) */}
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3 w-full">
                      {currentHostOptions.map((option, idx) => (
                        <div
                          key={option.id}
                          className="bg-white border-2 border-black rounded-xl p-3 flex justify-between items-center shadow-[1.5px_1.5px_0px_0px_rgba(0,0,0,1)]"
                        >
                          <div className="flex items-center gap-2">
                            <span className="w-6 h-6 flex items-center justify-center rounded-full border border-black text-xs font-bold bg-gray-100 text-black">
                              {idx + 1}
                            </span>
                            <span className="text-sm font-bold text-black break-keep">
                              {option.text}
                            </span>
                          </div>

                          {/* 정답 공개(show_answer) 상태일 때만 배지 노출 */}
                          {roundStatus === "show_answer" && (
                            <span className={`text-[9px] font-black px-2 py-0.5 border border-black rounded-md shadow-[0.5px_0.5px_0px_0px_rgba(0,0,0,1)] shrink-0 ${option.isCorrect
                              ? (option.isLotto ? "bg-lemon text-yellow-800" : "bg-sky text-black")
                              : (option.isBomb ? "bg-bomb text-red-800" : "bg-gray-100 text-gray-500")
                              }`}>
                              {option.isCorrect
                                ? (option.isLotto ? (mode === "extreme" ? "🌟 럭키팡 정답! (+300 & 🎟️)" : "🌟 럭키팡 정답! (+300)") : "✔️ 일반정답 (+100)")
                                : (option.isBomb ? "💥 폭탄오답 (-100)" : "❌ 함정오답 (0)")
                              }
                            </span>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* 퀴즈 제어 버튼 (정답 공개 및 다음 문제 제어) */}
                {roundStatus === "show_question" ? (
                  <button
                    onClick={handleRevealAnswer}
                    className="px-10 py-4 bg-lemon text-black font-black text-lg neo-btn transition-all duration-150 cursor-pointer hover:-translate-y-0.5 hover:shadow-[5px_5px_0px_0px_rgba(0,0,0,1)] active:translate-y-0 active:shadow-[1.5px_1.5px_0px_0px_rgba(0,0,0,1)] animate-pulse select-none"
                  >
                    🎯 정답 및 해설 공개하기
                  </button>
                ) : (
                  <button
                    onClick={handleNextRound}
                    className="px-10 py-4 bg-sky text-black font-black text-lg neo-btn transition-all duration-150 cursor-pointer hover:-translate-y-0.5 hover:shadow-[5px_5px_0px_0px_rgba(0,0,0,1)] active:translate-y-0 active:shadow-[1.5px_1.5px_0px_0px_rgba(0,0,0,1)] select-none"
                  >
                    {currentRound >= totalRounds ? "🏁 게임 끝내기" : "➡️ 다음 문제로 넘어가기"}
                  </button>
                )}
              </div>
            )}

            {roomStatus === "drawing" && (
              <div className="flex flex-col items-center w-full max-w-2xl mx-auto">
                <span className="text-6xl mb-4">🎯</span>
                <h3 className="text-2xl font-black text-black">익스트림 럭키팡 티켓 추첨 단계</h3>
                <p className="text-sm font-bold text-gray-500 mt-2 max-w-sm break-keep mb-6">
                  선생님 대시보드 화면에서도 실시간 티켓 추첨현황이 동기화되어 표출됩니다.
                </p>

                {winningNumbers.length === 0 ? (
                  <button
                    onClick={handleDrawNumbers}
                    className="px-10 py-4 bg-lemon text-black font-black text-lg neo-btn"
                  >
                    🎯 럭키팡 티켓 추첨하기
                  </button>
                ) : (
                  <div className="flex flex-col items-center gap-6 w-full">
                    <div className="w-full">
                      <LuckyDrawMachine
                        winningNumbers={winningNumbers}
                        myTickets={[]}
                        onFinishDraw={() => { }}
                        roomCode={`${displayRoomCode || roomCode}_s${gameSession}`}
                        isHost={true}
                        allPlayers={players}
                        revealedCount={drawRevealedCount}
                        onRevealedCountChange={handleRevealedCountChange}
                      />
                    </div>
                    {isLocalSim ? (
                      <p className="text-xs font-bold text-yellow-600 bg-yellow-50 px-3 py-1 border border-yellow-300 rounded-full animate-pulse mt-2">
                        🎲 봇들의 티켓 번호 대조 및 랭킹 정산 중...
                      </p>
                    ) : (
                      <button
                        onClick={handleFinishGame}
                        className="px-10 py-4 bg-pink text-red-950 font-black text-lg neo-btn"
                      >
                        🏁 최종 결과 발표하기
                      </button>
                    )}
                  </div>
                )}
              </div>
            )}

            {roomStatus === "finished" && (
              <div className="flex flex-col items-center">
                <span className="text-6xl mb-3">👑</span>
                <h3 className="text-3xl font-black text-black">최종 랭킹 집계 완료</h3>
                <p className="text-sm font-bold text-gray-500 mt-1 mb-6">
                  오늘의 럭키팡 탑 플레이어 목록입니다!
                </p>

                {/* TOP 3 우승 카드 연출 */}
                <div className="flex gap-4 items-end justify-center mb-6 w-full max-w-md">
                  {scoreboardList[1] && (
                    <div className="bg-white border-2 border-black rounded-t-xl p-3 w-28 text-center h-28 flex flex-col justify-between shadow-[2px_2px_0px_0px_rgba(0,0,0,1)]">
                      <span className="text-xs font-extrabold text-gray-500">🥈 2등</span>
                      <span className="text-sm font-bold text-black truncate">{scoreboardList[1].nickname}</span>
                      <span className="text-xs font-black text-sky-700 bg-sky-50 px-1 border border-sky-300 rounded">
                        {(scoreboardList[1].score || 0) + (scoreboardList[1].bonus_score || 0)}점
                      </span>
                    </div>
                  )}
                  {scoreboardList[0] && (
                    <div className="bg-lemon border-4 border-yellow-500 rounded-t-2xl p-4 w-32 text-center h-36 flex flex-col justify-between shadow-[3px_3px_0px_0px_rgba(0,0,0,1)] scale-105">
                      <span className="text-sm font-black text-yellow-700">🥇 1등</span>
                      <span className="text-base font-black text-black truncate">{scoreboardList[0].nickname}</span>
                      <span className="text-xs font-black text-yellow-800 bg-yellow-100 px-1 border border-yellow-400 rounded">
                        {(scoreboardList[0].score || 0) + (scoreboardList[0].bonus_score || 0)}점
                      </span>
                    </div>
                  )}
                  {scoreboardList[2] && (
                    <div className="bg-white border-2 border-black rounded-t-xl p-3 w-28 text-center h-24 flex flex-col justify-between shadow-[2px_2px_0px_0px_rgba(0,0,0,1)]">
                      <span className="text-xs font-extrabold text-gray-500">🥉 3등</span>
                      <span className="text-sm font-bold text-black truncate">{scoreboardList[2].nickname}</span>
                      <span className="text-xs font-black text-pink-700 bg-pink-50 px-1 border border-pink-300 rounded">
                        {(scoreboardList[2].score || 0) + (scoreboardList[2].bonus_score || 0)}점
                      </span>
                    </div>
                  )}
                </div>

                {/* 상위 5명 제한 최종 스코어보드 리스트 추가 */}
                <div className="w-full max-w-xl border-4 border-black rounded-3xl bg-cream p-5 mt-2 mb-6 shadow-[4px_4px_0px_0px_rgba(0,0,0,1)] text-left">
                  <div className="bg-sky border-2 border-black rounded-xl p-2.5 mb-4 shadow-[1.5px_1.5px_0px_0px_rgba(0,0,0,1)]">
                    <h4 className="text-base font-black text-black text-center">
                      🏆 럭키팡 최종 TOP 5 점수판
                    </h4>
                  </div>
                  <div className="flex flex-col gap-2 pr-1">
                    {scoreboardList.length === 0 ? (
                      <div className="text-center text-xs text-gray-400 py-4">
                        참가자가 없습니다.
                      </div>
                    ) : (
                      scoreboardList.slice(0, 5).map((player, idx) => {
                        const total = (player.score || 0) + (player.bonus_score || 0);
                        return (
                          <div
                            key={player.id}
                            className={`border-2 border-black rounded-lg p-2.5 flex justify-between items-center shadow-[1.5px_1.5px_0px_0px_rgba(0,0,0,1)] ${idx === 0 ? "bg-yellow-100" : idx === 1 ? "bg-gray-100" : idx === 2 ? "bg-orange-50" : "bg-white"
                              }`}
                          >
                            <div className="flex items-center gap-3">
                              <span className={`w-6 h-6 flex items-center justify-center rounded-full border border-black text-xs font-black shrink-0 ${idx === 0 ? "bg-yellow-400 text-yellow-950" :
                                idx === 1 ? "bg-gray-300 text-gray-800" :
                                  idx === 2 ? "bg-amber-500 text-amber-950" : "bg-gray-100 text-gray-500"
                                }`}>
                                {idx + 1}
                              </span>
                              <span className="text-sm font-black text-black truncate max-w-[120px] sm:max-w-[200px]">
                                {player.nickname}
                              </span>
                            </div>
                            <div className="flex items-center gap-2">
                              <span className="text-xs text-gray-500 font-bold">
                                기본 {player.score || 0}점 + 보너스 {player.bonus_score || 0}점
                              </span>
                              <span className="bg-lemon border border-black text-xs font-black px-2 py-0.5 rounded shadow-[0.5px_0.5px_0px_rgba(0,0,0,1)]">
                                {total}점
                              </span>
                            </div>
                          </div>
                        );
                      })
                    )}
                  </div>
                </div>

                <div className="flex flex-col sm:flex-row gap-3.5 mt-2">
                  <button
                    onClick={handleResetToWaiting}
                    className="px-6 py-3 bg-lemon text-black font-black text-sm neo-btn flex items-center justify-center gap-1.5"
                  >
                    🔄 대기실로 돌아가기 (한 판 더 하기)
                  </button>
                  <button
                    onClick={handleHostTerminate}
                    className="px-6 py-3 bg-white text-black font-black text-sm neo-btn flex items-center justify-center gap-1.5"
                  >
                    🚪 게임방 완전히 종료하고 퇴장
                  </button>
                </div>
              </div>
            )}
          </div>

          {/* 우측: 참가자 명단 및 실시간 스코어보드 (좌측 패널 바닥선과 100% 완벽 일치) */}
          <div className={`w-full lg:w-96 bg-white neo-box p-4 flex flex-col shrink-0 ${showRanking ? 'h-auto self-stretch' : 'h-auto self-start'}`}>
            {/* 랭킹보드 타이틀 + iOS 스타일 토글 스위치 */}
            <div className="bg-sky border-2 border-black rounded-xl p-2.5 mb-4 shadow-[1.5px_1.5px_0px_0px_rgba(0,0,0,1)] flex justify-between items-center">
              <h4 className="text-base font-black text-black">
                🏆 실시간 점수랭킹
              </h4>
              {/* iOS 토글 스위치 */}
              <button
                onClick={() => setShowRanking(!showRanking)}
                className={`relative w-11 h-6 rounded-full border-2 border-black overflow-hidden transition-colors duration-200 cursor-pointer shrink-0 shadow-[1px_1px_0px_0px_rgba(0,0,0,1)] ${showRanking ? 'bg-black' : 'bg-gray-300'
                  }`}
                title={showRanking ? '랭킹보드 숨기기' : '랭킹보드 보이기'}
              >
                <span
                  className={`absolute top-[3px] left-0 w-[14px] h-[14px] rounded-full bg-white border border-black shadow transition-transform duration-200 ${showRanking ? 'translate-x-[22px]' : 'translate-x-[3px]'
                    }`}
                />
              </button>
            </div>

            {/* 랭킹 리스트 — 토글 상태에 따라 표시/숨김 (2열 레이아웃 적용) */}
            {showRanking && (
              <div className="flex-1 overflow-y-auto pr-1">
                {scoreboardList.length === 0 ? (
                  <div className="h-full flex items-center justify-center border border-dashed border-gray-300 rounded-xl p-4 text-xs text-gray-400">
                    접속한 학생이 아직 없습니다.
                  </div>
                ) : (
                  <div className="grid grid-cols-2 gap-2 auto-rows-max">
                    {scoreboardList.map((player, idx) => {
                      const total = (player.score || 0) + (player.bonus_score || 0);
                      return (
                        <div
                          key={player.id}
                          className="bg-cream border-2 border-black rounded-lg p-2 flex justify-between items-center shadow-[1.5px_1.5px_0px_0px_rgba(0,0,0,1)] min-w-0"
                        >
                          <div className="flex items-center gap-1.5 min-w-0">
                            <span className="text-[11px] font-black text-white bg-black w-4.5 h-4.5 flex items-center justify-center rounded-full shrink-0">
                              {idx + 1}
                            </span>
                            <span className="text-xs font-bold text-black truncate max-w-[70px]" title={player.nickname}>
                              {player.nickname}
                            </span>
                          </div>

                          <div className="flex items-center gap-1 shrink-0">
                            {/* 획득 럭키팡 티켓 개수 배지 */}
                            {mode === "extreme" && (
                              <span className="bg-white border border-black text-[9px] font-black px-1 py-0.5 rounded shadow-[0.5px_0.5px_0px_0px_rgba(0,0,0,1)] whitespace-nowrap">
                                🎟️{player.ticket_count || player.tickets?.length || 0}장
                              </span>
                            )}
                            {/* 총점 배지 */}
                            <span className="bg-sky border border-black text-[11px] font-black px-1.5 py-0.5 rounded text-black shadow-[0.5px_0.5px_0px_0px_rgba(0,0,0,1)] whitespace-nowrap">
                              {total}점
                            </span>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            )}
          </div>

        </div>

        {/* 참가자 명단 확인 모달 팝업 (교사용) */}
        {showPlayersModal && (
          <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
            <div className="bg-white border-4 border-black rounded-3xl p-6 w-full max-w-md shadow-[6px_6px_0px_0px_rgba(0,0,0,1)] animate-in fade-in zoom-in-95 duration-150">
              <div className="flex justify-between items-center border-b-4 border-black pb-3 mb-4">
                <h3 className="text-xl font-black text-black flex items-center gap-2">
                  👥 참가자 명단 <span className="bg-lemon border-2 border-black px-2 py-0.5 rounded-lg text-sm">{scoreboardList.length}명</span>
                </h3>
                <button
                  onClick={() => setShowPlayersModal(false)}
                  className="text-gray-500 hover:text-black font-black text-lg p-1"
                >
                  ✕
                </button>
              </div>

              <div className="max-h-60 overflow-y-auto pr-1 flex flex-col gap-2 mb-6">
                {scoreboardList.length === 0 ? (
                  <div className="text-center py-8 text-sm font-bold text-gray-400 border-2 border-dashed border-gray-300 rounded-2xl">
                    현재 대기실에 입장한 학생이 없습니다.
                  </div>
                ) : (
                  scoreboardList.map((player, idx) => (
                    <div
                      key={player.id}
                      className="bg-cream border-2 border-black rounded-xl p-3 flex justify-between items-center shadow-[2px_2px_0px_0px_rgba(0,0,0,1)]"
                    >
                      <div className="flex items-center gap-2.5">
                        <span className="bg-black text-white text-xs font-black w-6 h-6 flex items-center justify-center rounded-full">
                          {idx + 1}
                        </span>
                        <span className="text-base font-black text-black">
                          {player.nickname}
                        </span>
                      </div>
                      {player.student_number && (
                        <span className="bg-white border-2 border-black text-xs font-black px-2.5 py-1 rounded-lg">
                          번호: {player.student_number}번
                        </span>
                      )}
                    </div>
                  ))
                )}
              </div>

              <button
                onClick={() => setShowPlayersModal(false)}
                className="w-full py-3.5 bg-lemon text-black border-2 border-black rounded-xl font-black text-sm neo-btn"
              >
                확인 및 닫기
              </button>
            </div>
          </div>
        )}

        {toastMessage && (
          <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 bg-[#00FF66] text-slate-900 border-4 border-black px-6 py-2.5 rounded-2xl font-black text-sm shadow-[4px_4px_0px_#000] animate-in fade-in slide-in-from-bottom-4 duration-300">
            {toastMessage}
          </div>
        )}

        {/* QR코드 모달 팝업 */}
        {showQrModal && (
          <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm z-50 flex items-center justify-center p-4 animate-in fade-in duration-200" onClick={() => setShowQrModal(false)}>
            <div
              className="bg-cream rounded-[32px] border-6 border-black shadow-[8px_8px_0px_#000] p-6 max-w-sm w-full space-y-5 relative text-center animate-in zoom-in-95 duration-200"
              onClick={(e) => e.stopPropagation()}
            >
              {/* 닫기 버튼 */}
              <button
                onClick={() => setShowQrModal(false)}
                className="absolute top-4 right-4 bg-white text-black w-8 h-8 rounded-full border-2 border-black font-black hover:bg-slate-100 shadow-[2px_2px_0px_#000] flex items-center justify-center cursor-pointer active:translate-y-[1px] active:shadow-[1px_1px_0px_#000] transition-all text-sm"
              >
                ✕
              </button>

              <div className="space-y-1 pt-2">
                <span className="bg-indigo-600 text-white text-[10px] font-black px-2.5 py-0.5 rounded-full border border-black shadow-[1.5px_1.5px_0px_#000] uppercase tracking-wider">LOBBY QR</span>
                <h3 className="text-xl font-black text-slate-900 leading-none">방 입장 QR코드</h3>
                <p className="text-[10px] font-bold text-slate-600">카메라로 스캔하면 즉시 로그인 화면으로 진입합니다.</p>
              </div>

              <div className="flex justify-center p-2.5 bg-white border-4 border-black rounded-2xl shadow-[4px_4px_0px_#000] max-w-[220px] mx-auto min-h-[210px] items-center">
                {inviteLink ? (
                  <QRCodeSVG
                    value={inviteLink}
                    size={180}
                    level="M"
                    includeMargin={false}
                    className="select-none"
                  />
                ) : (
                  <div className="w-[180px] h-[180px] flex items-center justify-center text-xs font-bold text-gray-400 animate-pulse">
                    QR코드 생성 중...
                  </div>
                )}
              </div>

              <div className="space-y-1.5">
                <div className="bg-white border-2 border-black rounded-xl p-2 shadow-[2px_2px_0px_#000] text-[10px] font-black text-slate-700 break-all select-all">
                  {inviteLink}
                </div>
                <button
                  onClick={() => copyToClipboard(inviteLink, "초대 링크가 복사되었습니다! 🔗")}
                  className="w-full bg-lemon text-black font-black text-xs py-2.5 rounded-xl border-3 border-black hover:bg-yellow-400 transition-all shadow-[2.5px_2.5px_0px_#000] active:translate-y-[1px] active:shadow-[1px_1px_0px_#000] cursor-pointer"
                >
                  🔗 초대 링크 복사하기
                </button>
              </div>
            </div>
          </div>
        )}

      </div>
    );
  }

  // --- 8. 학생 플레이어 뷰 렌더링 ---
  return (
    <div className="flex flex-col min-h-screen bg-cream px-3 py-3 md:px-4 md:py-4">
      {/* 학생 상단 헤더 바 (Student Header Bar: 상단 프로필 & 상태바) */}
      <div className="w-full max-w-4xl mx-auto bg-white border-4 border-black rounded-2xl p-3 md:p-4 mb-4 shadow-[4px_4px_0px_0px_rgba(0,0,0,1)] flex flex-wrap justify-between items-center gap-3">
        {/* 왼쪽: 학생 이름 + 라운드 결과 배지 (가로 배치) */}
        <div className="flex flex-wrap items-center gap-2.5">
          <span className="text-xl md:text-2xl font-black text-black flex items-center gap-1.5 shrink-0">
            <span>🎒</span> {nickname}
          </span>
          {roomStatus === "playing" && roundStatus === "show_answer" && (
            <span className="bg-sky text-black border-2 border-black px-2.5 py-1 rounded-xl text-xs font-black shadow-[1px_1px_0px_0px_rgba(0,0,0,1)] animate-pulse shrink-0">
              ROUND {currentRound} 결과 확인
            </span>
          )}
        </div>

        {/* 오른쪽: 방번호 - 내점수 - 티켓 - 나가기 단추 그룹 */}
        <div className="flex flex-wrap items-center gap-2">
          <button
            onClick={handleCopyRoomCode}
            className="bg-white border-2 border-black rounded-xl px-3 py-1.5 text-xs md:text-sm font-black text-gray-700 shadow-[1px_1px_0px_0px_rgba(0,0,0,1)] hover:-translate-y-0.5 transition-all cursor-pointer select-none flex items-center gap-1.5 shrink-0 whitespace-nowrap"
            title="클릭하여 방 번호 복사"
          >
            <span>방 번호:</span>
            <span className="font-['Noto_Sans_KR',sans-serif] text-sm md:text-base font-black text-indigo-700 leading-none">
              {displayRoomCode || roomCode}
            </span>
            <span className="text-[10px]">{copied ? "✅" : "📋"}</span>
          </button>
          {roomStatus === "waiting" && (
            <button
              onClick={() => copyToClipboard(inviteLink, "초대 링크가 복사되었습니다! 🔗")}
              title="초대 링크 복사"
              className="bg-white border-2 border-black rounded-xl px-3 py-1.5 text-xs md:text-sm font-black text-gray-700 shadow-[1px_1px_0px_0px_rgba(0,0,0,1)] hover:-translate-y-0.5 transition-all cursor-pointer select-none flex items-center gap-1 shrink-0"
            >
              <span>🔗 링크 복사</span>
            </button>
          )}
          <span className="bg-lemon border-2 border-black rounded-xl px-3.5 py-1.5 text-xs md:text-sm font-black text-black shadow-[1px_1px_0px_0px_rgba(0,0,0,1)] shrink-0">
            내 점수: {myScore}점
          </span>
          {mode === "extreme" && (
            <button
              onClick={() => setShowTicketModal(true)}
              title="클릭하여 내 티켓 보관함 열기"
              className="bg-sky border-2 border-black rounded-xl px-3.5 py-1.5 text-xs md:text-sm font-black text-black shadow-[1px_1px_0px_0px_rgba(0,0,0,1)] hover:-translate-y-0.5 hover:shadow-[2px_2px_0px_0px_rgba(0,0,0,1)] transition-all cursor-pointer select-none shrink-0 flex items-center gap-1"
            >
              <span>🎫 티켓: {myTickets.length}장</span>
            </button>
          )}
          <button
            onClick={handleStudentExit}
            className="bg-pink border-2 border-black rounded-xl px-4 py-1.5 text-xs md:text-sm font-black text-red-900 shadow-[1px_1px_0px_0px_rgba(0,0,0,1)] hover:-translate-y-0.5 transition-all cursor-pointer select-none shrink-0"
          >
            🚪 나가기
          </button>
        </div>
      </div>

      {/* 메인 레이아웃 분기 */}
      <div className="flex-1 w-full flex flex-col lg:flex-row gap-6 items-stretch justify-center">
        {roomStatus === "waiting" && (
          <div className="flex-1 flex flex-col items-center justify-center bg-white neo-box p-8 text-center max-w-2xl min-h-[300px] select-none">
            <span className="text-6xl animate-pulse mb-4">🏫</span>
            <h3 className="text-2xl font-black text-black">대기실에 입장했습니다!</h3>
            <p className="text-sm font-bold text-gray-500 mt-2 max-w-xs break-keep">
              선생님 화면(대시보드)에 내 이름이 올바르게 뜨는지 확인하고, 선생님이 게임을 시작하실 때까지 대기해주세요.
            </p>

            {/* 실시간 퀴즈 설정 상황 배너 */}
            <div className="mt-8 bg-cream border-2 border-black rounded-2xl p-4 w-full max-w-sm shadow-[2.5px_2.5px_0px_0px_rgba(0,0,0,1)] flex flex-col items-center gap-2">
              <span className="text-[10px] font-black text-gray-400 block tracking-wide">📡 실시간 선생님 설정 정보</span>
              <div className="flex gap-2 flex-wrap justify-center items-center mt-1">
                <span className="bg-sky border-2 border-black rounded-lg px-3 py-1 text-xs font-black text-black shadow-[1px_1px_0px_rgba(0,0,0,1)]">
                  문제 수: {totalRounds}문항
                </span>
                <span className="bg-lemon border-2 border-black rounded-lg px-3 py-1 text-xs font-black text-black shadow-[1px_1px_0px_rgba(0,0,0,1)]">
                  문제 유형: {
                    roomDifficulty === "easy" ? "유형 1 (약수&배수 찾기) 🟢" :
                      roomDifficulty === "hard" ? "유형 2 (공약수&공배수) 🔵" :
                        roomDifficulty === "normal" ? "유형 3 (약수&배수 관계 및 성질) 🟡" :
                          `믹스 유형 🟠 (${roomRatio})`
                  }
                </span>
              </div>
            </div>
          </div>
        )}

        {roomStatus === "playing" && currentQuiz && (
          <div className="flex-1 flex flex-col lg:flex-row gap-3 md:gap-4 items-start justify-center max-w-5xl w-full">
            {roundStatus === "show_question" ? (
              /* 퀴즈 풀이 단계 */
              <div className="flex-1 flex flex-col items-center gap-5 w-full">
                <div className="bg-white border-4 border-black rounded-full px-12 py-3 text-xl md:text-3xl font-black text-black shadow-[4px_4px_0px_0px_rgba(0,0,0,1)]">
                  문제 {currentRound} / {totalRounds}
                </div>
                <QuizCard
                  quiz={currentQuiz}
                  onSelectOption={handleSelectOption}
                  disabled={false}
                  isExtremeMode={mode === "extreme"}
                />
                {hasSubmittedThisRound && (
                  <div className="text-center font-bold text-xs text-gray-500 animate-pulse mt-2.5 bg-white border-2 border-black rounded-xl px-4 py-2.5 shadow-[1.5px_1.5px_0px_0px_rgba(0,0,0,1)]">
                    정답 제출 완료! 선생님이 정답을 공개하시기 전까지 답을 바꿀 수 있습니다. ⏳
                  </div>
                )}
              </div>
            ) : (
              /* 정답 확인 및 결과 피드백 단계 */
              <div className="flex-1 flex flex-col items-center gap-3 w-full">
                <div className="bg-white border-2 md:border-4 border-black rounded-2xl p-4 md:p-4.5 w-full max-w-xl shadow-[4px_4px_0px_0px_rgba(0,0,0,1)] text-center">
                  <h3 className="text-lg md:text-xl font-black text-black mb-3">📢 정답 공개 및 채점 결과</h3>

                  {/* 내가 제출한 답변 카드 */}
                  <div className="bg-cream border-4 border-black rounded-2xl p-4 md:p-4 mb-3 text-center flex flex-col items-center justify-center min-h-[85px] py-3 shadow-[3px_3px_0px_0px_rgba(0,0,0,1)]">
                    <span className="text-xs md:text-sm text-gray-500 font-extrabold mb-1.5 block">내가 고른 보기</span>
                    {mySelectedOption ? (
                      <div className="text-2xl md:text-3.5xl font-black text-black tracking-wide">
                        {mySelectedOption.text}
                      </div>
                    ) : (
                      <div className="text-2xl md:text-3.5xl font-black text-red-600 tracking-wide">
                        선택하지 않음 (미제출)
                      </div>
                    )}
                  </div>

                  {/* 정답 판정 결과 대형 배지 */}
                  <div className="my-2.5">
                    {mySelectedOption ? (
                      mySelectedOption.isCorrect ? (
                        mySelectedOption.isLotto ? (
                          <div className="bg-lemon border border-black rounded-xl p-4 text-xl md:text-2xl font-black text-yellow-800 shadow-[2px_2px_0px_0px_rgba(0,0,0,1)] animate-bounce">
                            {mode === "extreme" ? "🎉 럭키팡 정답! (+300점 & 🎟️ 획득)" : "🎉 럭키팡 정답! (+300점 획득)"}
                          </div>
                        ) : (
                          <div className="bg-sky border border-black rounded-xl p-4 text-xl md:text-2xl font-black text-blue-800 shadow-[2px_2px_0px_0px_rgba(0,0,0,1)] animate-pulse">
                            ✔️ 정답입니다! (+100점 획득)
                          </div>
                        )
                      ) : mySelectedOption.isBomb ? (
                        <div className="bg-bomb border border-black rounded-xl p-4 text-xl md:text-2xl font-black text-red-800 shadow-[2px_2px_0px_0px_rgba(0,0,0,1)]">
                          💥 폭탄을 골랐어요! (-100점 감점)
                        </div>
                      ) : (
                        <div className="bg-gray-100 border border-black rounded-xl p-4 text-xl md:text-2xl font-black text-gray-500 shadow-[2px_2px_0px_0px_rgba(0,0,0,1)]">
                          ❌ 아쉬운 오답입니다! (0점)
                        </div>
                      )
                    ) : (
                      <div className="bg-gray-100 border border-black rounded-xl p-4 text-xl md:text-2xl font-black text-gray-400 shadow-[2px_2px_0px_0px_rgba(0,0,0,1)]">
                        ⚠️ 답안을 제출하지 않았습니다. (0점)
                      </div>
                    )}
                  </div>

                  {/* 이 라운드의 정답 및 오답 해설 리스트 */}
                  <div className="text-left bg-gray-50 border border-black rounded-xl p-3.5 shadow-[2px_2px_0px_0px_rgba(0,0,0,1)] flex flex-col gap-1.5 w-full">
                    <div className="flex justify-between items-center mb-1.5">
                      <span className="text-[10px] text-gray-600 font-black">💡 문제 풀이 해설</span>
                      <button
                        onClick={handleToggleBookmark}
                        className={`text-[9px] font-black border-2 border-black rounded-lg px-2 py-1 shadow-[1px_1px_0px_rgba(0,0,0,1)] transition-all flex items-center gap-1 select-none cursor-pointer hover:-translate-y-0.5 ${bookmarkedQuizzes.some((q) => q.round === currentRound)
                          ? "bg-pink text-red-950"
                          : "bg-white text-gray-600 hover:bg-cream"
                          }`}
                      >
                        {bookmarkedQuizzes.some((q) => q.round === currentRound)
                          ? "🔖 책갈피 완료"
                          : "📌 복습용 책갈피"}
                      </button>
                    </div>

                    {currentQuiz.options.map((opt) => {
                      const isCorrect = opt.isCorrect;
                      const isLotto = opt.isLotto;
                      const isBomb = opt.isBomb;

                      let badgeStyle = "";
                      let badgeText = "";

                      if (isCorrect) {
                        if (isLotto) {
                          badgeStyle = "bg-lemon text-yellow-950 border-yellow-500";
                          badgeText = "🌟 럭키팡 정답!";
                        } else {
                          badgeStyle = "bg-sky text-blue-950 border-blue-500";
                          badgeText = "✔️ 일반정답";
                        }
                      } else {
                        if (isBomb) {
                          badgeStyle = "bg-bomb text-red-950 border-red-500";
                          badgeText = "💥 폭탄오답";
                        } else {
                          badgeStyle = "bg-gray-200 text-gray-800 border-gray-400";
                          badgeText = "❌ 함정오답";
                        }
                      }

                      return (
                        <div key={opt.id} className="flex flex-col border-b border-gray-100 pb-2 last:border-b-0 last:pb-0">
                          <div className="flex items-start gap-2">
                            <span className={`text-[9px] font-black px-1.5 py-0.5 border border-black rounded shrink-0 mt-0.5 shadow-[0.5px_0.5px_0px_0px_rgba(0,0,0,1)] ${badgeStyle}`}>
                              {badgeText}
                            </span>
                            <div className="text-sm font-extrabold text-black">
                              {opt.text}
                            </div>
                          </div>
                          {opt.description && (
                            <p className="text-xs text-gray-500 font-bold ml-12 mt-1 break-keep leading-relaxed">
                              ↳ {opt.description}
                            </p>
                          )}
                        </div>
                      );
                    })}
                  </div>

                  <p className="text-[10px] font-bold text-gray-400 mt-3 animate-pulse">
                    선생님이 다음 문제로 넘어갈 때까지 잠시 대기하세요!
                  </p>
                </div>
              </div>
            )}
          </div>
        )}

        {roomStatus === "drawing" && (
          <div className="flex-1 flex justify-center items-center max-w-2xl">
            {winningNumbers.length === 0 ? (
              <div className="w-full bg-white neo-box p-8 text-center flex flex-col items-center">
                <span className="text-5xl mb-4 animate-bounce">🎯</span>
                <h3 className="text-xl md:text-2xl font-black text-black">행운 티켓 추첨 준비 중</h3>
                <p className="text-sm font-bold text-gray-500 mt-2 max-w-sm break-keep">
                  선생님이 곧 럭키팡 티켓 추첨을 시작합니다. 잠시만 기다려주세요! 🍀
                </p>
                <div className="mt-4 flex items-center gap-2 bg-amber-50 border-2 border-dashed border-amber-300 rounded-xl px-4 py-2">
                  <span className="text-xs font-black text-amber-700 animate-pulse">⏳ 선생님의 추첨 시작 신호 대기 중...</span>
                </div>
              </div>
            ) : (
              <LuckyDrawMachine
                winningNumbers={winningNumbers}
                myTickets={myTickets}
                onFinishDraw={handleFinishDraw}
                roomCode={`${displayRoomCode || roomCode}_s${gameSession}`}
                revealedCount={drawRevealedCount}
              />
            )}
          </div>
        )}

        {roomStatus === "finished" && (
          <div className="flex-1 flex flex-col items-center justify-center bg-white neo-box p-8 text-center max-w-2xl min-h-[300px]">
            <span className="text-6xl mb-4">🎉</span>
            <h3 className="text-2xl font-black text-black">퀴즈 게임 완료!</h3>
            <p className="text-sm font-bold text-gray-500 mt-1 max-w-sm break-keep">
              모든 라운드가 종료되었습니다. 아래 버튼을 눌러 최종 결과를 확인하세요! 🍀
            </p>

            <div className="flex flex-col sm:flex-row gap-3 mt-6 w-full justify-center">
              <button
                onClick={() => setShowResultModal(true)}
                className="px-8 py-3.5 bg-lemon text-black font-black text-base neo-btn"
              >
                📋 최종 결과 확인하기
              </button>
              {bookmarkedQuizzes.length > 0 && (
                <button
                  onClick={() => setShowReviewModal(true)}
                  className="px-8 py-3.5 bg-white border-2 border-black text-black font-black text-base neo-btn flex items-center justify-center gap-2"
                >
                  <span>🔖 책갈피 복습하기</span>
                  <span className="bg-pink text-red-950 border border-black rounded-full px-2 py-0.2 text-xs font-black shadow-[0.5px_0.5px_0px_rgba(0,0,0,1)]">
                    {bookmarkedQuizzes.length}
                  </span>
                </button>
              )}
            </div>
          </div>
        )}
      </div>

      {/* 티켓 보관함 팝업 모달 (익스트림 모드일 때 팝업) */}
      {showTicketModal && mode === "extreme" && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-cream border-4 border-black rounded-3xl p-4 md:p-6 w-full max-w-md md:max-w-lg shadow-[6px_6px_0px_0px_rgba(0,0,0,1)] relative max-h-[88vh] flex flex-col">
            {/* 닫기 버튼 */}
            <button
              onClick={() => setShowTicketModal(false)}
              className="absolute top-3 right-3 z-10 bg-pink border-2 border-black rounded-xl w-9 h-9 flex items-center justify-center font-black text-red-900 text-lg shadow-[2px_2px_0px_0px_rgba(0,0,0,1)] hover:-translate-y-0.5 transition-all cursor-pointer select-none"
            >
              ✕
            </button>
            <div className="pt-2 w-full flex-1 overflow-y-auto">
              <TicketInventory tickets={myTickets} />
            </div>
          </div>
        </div>
      )}

      {/* 최종 결과 모달 팝업 */}
      {showResultModal && (
        <ResultExport
          nickname={nickname}
          score={myScore}
          bonusScore={myBonusScore}
          tickets={myTickets}
          isExtremeMode={mode === "extreme"}
          onClose={() => setShowResultModal(false)}
          correctCount={myRoundResults.filter((r) => r.isCorrect).length}
          wrongCount={Math.max(0, totalRounds - myRoundResults.filter((r) => r.isCorrect).length)}
        />
      )}

      {/* 책갈피 복습용 모달 팝업 */}
      {showReviewModal && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center p-4 z-50">
          <div className="w-full max-w-xl bg-cream border-4 border-black rounded-3xl p-6 shadow-[8px_8px_0px_0px_rgba(0,0,0,1)] relative flex flex-col max-h-[90vh]">
            {/* 상단 장식용 미니 카드 */}
            <div className="absolute -top-6 bg-pink border-2 border-black rounded-full px-6 py-2 shadow-[2px_2px_0px_0px_rgba(0,0,0,1)] font-extrabold text-black text-sm">
              🔖 책갈피 오답&개념 복습 🔖
            </div>

            <div className="w-full text-center mt-4 mb-4">
              <h3 className="text-2xl font-black text-black">내가 저장한 문제 모아보기</h3>
              <p className="text-xs font-bold text-gray-500 mt-1">
                틀렸던 문제나 헷갈리는 문제를 복습하며 다시 한 번 익혀보세요!
              </p>
            </div>

            {/* 스크롤 가능한 문제 리스트 */}
            <div className="flex-1 overflow-y-auto pr-1 flex flex-col gap-4 mb-6">
              {bookmarkedQuizzes.map((item, index) => (
                <div key={index} className="bg-white border-2 border-black rounded-2xl p-4 shadow-[3px_3px_0px_0px_rgba(0,0,0,1)] text-left flex flex-col gap-3">
                  <div className="flex justify-between items-center border-b-2 border-dashed border-gray-200 pb-2">
                    <span className="bg-lemon border-2 border-black rounded-full px-3 py-0.5 text-xs font-black text-black shadow-[1px_1px_0px_rgba(0,0,0,1)]">
                      ROUND {item.round}
                    </span>
                    {/* 개별 북마크 제거 기능 */}
                    <button
                      onClick={() => {
                        const cacheKey = `luckypang_bookmarks_room_${dbRoomId}`;
                        const nextList = bookmarkedQuizzes.filter((q) => q.round !== item.round);
                        setBookmarkedQuizzes(nextList);
                        localStorage.setItem(cacheKey, JSON.stringify(nextList));
                      }}
                      className="text-xs text-red-500 font-bold hover:underline select-none cursor-pointer"
                    >
                      제거
                    </button>
                  </div>

                  <h4 className="text-base font-black text-black leading-relaxed">
                    {item.quiz.question_text}
                  </h4>

                  {/* 해당 문제의 모든 선택지 해설 가이드 */}
                  <div className="bg-gray-55 border border-black rounded-xl p-3 flex flex-col gap-2">
                    {item.quiz.options.map((opt) => {
                      const isCorrect = opt.isCorrect;
                      const isLotto = opt.isLotto;
                      const isBomb = opt.isBomb;

                      let badgeStyle = "";
                      let badgeText = "";

                      if (isCorrect) {
                        if (isLotto) {
                          badgeStyle = "bg-lemon text-yellow-950 border-yellow-500";
                          badgeText = "🌟 럭키팡 정답!";
                        } else {
                          badgeStyle = "bg-sky text-blue-950 border-blue-500";
                          badgeText = "✔️ 일반정답";
                        }
                      } else {
                        if (isBomb) {
                          badgeStyle = "bg-bomb text-red-950 border-red-500";
                          badgeText = "💥 폭탄오답";
                        } else {
                          badgeStyle = "bg-gray-200 text-gray-800 border-gray-400";
                          badgeText = "❌ 함정오답";
                        }
                      }

                      return (
                        <div key={opt.id} className="flex flex-col border-b border-gray-100 pb-2 last:border-b-0 last:pb-0">
                          <div className="flex items-start gap-2">
                            <span className={`text-[9px] font-black px-1.5 py-0.5 border border-black rounded shrink-0 mt-0.5 shadow-[0.5px_0.5px_0px_0px_rgba(0,0,0,1)] ${badgeStyle}`}>
                              {badgeText}
                            </span>
                            <div className="text-sm font-extrabold text-black">
                              {opt.text}
                            </div>
                          </div>
                          {opt.description && (
                            <p className="text-xs text-gray-500 font-bold ml-12 mt-1 break-keep leading-relaxed">
                              ↳ {opt.description}
                            </p>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>

            {/* 하단 단추 리스트 */}
            <div className="flex gap-3 w-full mt-2">
              <button
                onClick={() => setShowReviewModal(false)}
                className="flex-1 py-4 bg-sky text-black font-black text-base neo-btn"
              >
                닫기
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 학생 전용: 선생님(방장) 접속 유실 대기 모달 */}
      {hostDisconnectTimer !== null && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-md flex items-center justify-center p-4 z-50 flex-col">
          <div className="w-full max-w-md bg-cream border-4 border-black rounded-3xl p-6 shadow-[8px_8px_0px_0px_rgba(0,0,0,1)] text-center relative">
            <span className="text-6xl animate-bounce mb-4 block">📡</span>
            <h3 className="text-2xl font-black text-black">선생님 연결 대기 중</h3>
            <p className="text-sm font-bold text-gray-600 mt-2 break-keep">
              선생님의 네트워크 접속이 일시적으로 끊겼습니다.<br />
              선생님이 다시 들어오실 때까지 잠시 기다려 주세요!
            </p>

            {/* 분:초 카운트다운 타이머 배지 */}
            <div className="bg-pink border-2 border-black rounded-xl py-3 px-6 my-6 shadow-[3px_3px_0px_0px_rgba(0,0,0,1)] inline-block">
              <span className="text-3xl font-black text-red-950 font-mono">
                {Math.floor(hostDisconnectTimer / 60)}:{(hostDisconnectTimer % 60) < 10 ? "0" : ""}{hostDisconnectTimer % 60}
              </span>
            </div>

            <p className="text-xs font-bold text-gray-400">
              대기 시간이 초과되면 자동으로 대기실 로비로 이동합니다.
            </p>
          </div>
        </div>
      )}

      {/* 수업 중단 방지 안내 모달 (onFail / onHostLost) */}
      {showFallbackModal && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-md flex items-center justify-center p-4 z-50 flex-col">
          <div className="w-full max-w-md bg-cream border-4 border-black rounded-3xl p-6 shadow-[8px_8px_0px_0px_rgba(0,0,0,1)] text-center relative">
            <span className="text-6xl animate-bounce mb-4 block">🚨</span>
            <h3 className="text-2xl font-black text-black">안내</h3>
            <p className="text-sm font-bold text-gray-700 mt-3 break-keep">
              {fallbackReason || "선생님과의 연결이 원활하지 않습니다."}
            </p>
            <div className="bg-lemon border-2 border-black rounded-xl p-4 my-4 text-xs font-bold text-slate-800 leading-relaxed text-left">
              💡 <strong>수업 팁:</strong><br />
              • 교사가 안내한 6자리 방 번호가 맞는지 다시 확인해 주세요.<br />
              • 교사 화면이 대기실 상태로 켜져 있는지 확인해 주세요.<br />
              • 네트워크 상태가 불안정할 경우 잠시 후 다시 입장해 주세요.
            </div>
            <button
              onClick={() => {
                setShowFallbackModal(false);
                router.push("/?view=lobby");
              }}
              className="w-full py-3.5 bg-sky hover:bg-sky/80 text-black font-black text-lg border-3 border-black rounded-xl shadow-[3px_3px_0px_0px_rgba(0,0,0,1)] cursor-pointer"
            >
              로비로 돌아가기
            </button>
          </div>
        </div>
      )}

      {toastMessage && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 bg-[#00FF66] text-slate-900 border-4 border-black px-6 py-2.5 rounded-2xl font-black text-sm shadow-[4px_4px_0px_#000] animate-in fade-in slide-in-from-bottom-4 duration-300">
          {toastMessage}
        </div>
      )}


    </div>
  );
}

export default function GameRoomPage() {
  return (
    <React.Suspense fallback={
      <div className="flex flex-col items-center justify-center min-h-screen bg-cream gap-4">
        <span className="text-5xl animate-spin">🍀</span>
        <p className="text-2xl font-black text-black">게임방 불러오는 중...</p>
      </div>
    }>
      <GameRoomPageInner />
    </React.Suspense>
  );
}
