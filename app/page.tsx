"use client";

import React, { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { appAlert, appConfirm } from "@/lib/appDialog";

// 1. 공용 비속어(욕설) 방어용 금칙어 사전
const BAD_WORDS = [
  '개새끼', '개세끼', '개색기', '씨발', '시발', '씹알', '십알', '엠창', '엄창', '느금마',
  '지랄', '병신', '빙신', '호로', '존나', '좃나', '새끼', '세끼', '뒈져', '뒤져',
  '또라이', '미친놈', '미친년', '썅', '샹', '아가리', '새키', '세키', '씨바', '시바',
  '닥쳐', '대가리', '머가리', '꺼져', '빡대가리', '썅년', '썅놈', '새끼야', '호로새끼', '존나게'
];

export default function LobbyPage() {
  const router = useRouter();

  // 입력 폼 상태 변수
  const [nickname, setNickname] = useState("");
  const [enterCode, setEnterCode] = useState("");
  const [gameMode, setGameMode] = useState<"standard" | "extreme">("standard");

  // 랜딩 vs 로비 뷰 및 사용안내 모달 상태 변수
  const [viewMode, setViewMode] = useState<"landing" | "lobby">("landing");
  const [showGuideModal, setShowGuideModal] = useState<boolean>(false);
  const [isClient, setIsClient] = useState(false);

  // 닉네임 에러 및 로딩 상태 변수
  const [nicknameError, setNicknameError] = useState("");
  const [loading, setLoading] = useState(false);
  const [activeHostRoom, setActiveHostRoom] = useState<{ id: string; code: string; mode: string } | null>(null);

  // 문제 수 및 난이도 설정 상태 변수
  const ROUND_PRESETS = [6, 12, 18, 24, 30];
  const [sliderVal, setSliderVal] = useState(1); // 기본 12문항
  const [difficulty, setDifficulty] = useState<"easy" | "normal" | "hard" | "mix">("easy");
  const [ratio, setRatio] = useState<string>("1:1:1");

  const totalRounds = ROUND_PRESETS[sliderVal];

  useEffect(() => {
    setIsClient(true);

    if (typeof window !== "undefined") {
      // 1. 방장 복귀 정보 로드 (마지막 활동 후 30분간 아무 반응 없이 방치된 방만 자동 만료)
      const cached = localStorage.getItem("luckypang_host_active_room");
      if (cached) {
        try {
          const roomObj = JSON.parse(cached);
          const lastTime = roomObj.lastActiveAt || roomObj.createdAt || Date.now();
          if (Date.now() - lastTime > 30 * 60 * 1000) {
            // 30분 동안 아무런 활동 없이 방치된 무반응 방만 정리
            localStorage.removeItem("luckypang_host_active_room");
            setActiveHostRoom(null);
          } else {
            setActiveHostRoom(roomObj);
          }
        } catch (e) {
          console.error(e);
          localStorage.removeItem("luckypang_host_active_room");
        }
      }

      // 2. 60초 방 삭제 자율 청소(GC) 타이머 작동
      const checkBombTimer = setInterval(async () => {
        const bombPending = localStorage.getItem("luckypang_room_bomb_pending");
        if (bombPending) {
          try {
            const { roomId, bombTime } = JSON.parse(bombPending);
            if (Date.now() >= bombTime) {
              localStorage.removeItem("luckypang_room_bomb_pending");
            }
          } catch (e) {
            console.error("GC Error", e);
            localStorage.removeItem("luckypang_room_bomb_pending");
          }
        }
      }, 1000);

      // 3. URL 초대 코드 및 뷰 파라미터(?view=lobby, ?code=xxxxxx) 감지 및 로비 뷰 자동 전환
      const urlParams = new URLSearchParams(window.location.search);
      const viewParam = urlParams.get('view');
      if (viewParam === 'lobby') {
        setViewMode('lobby');
      }

      const paramCode = urlParams.get('code');
      if (paramCode) {
        setEnterCode(paramCode.replace(/[^0-9]/g, ""));
        setViewMode('lobby');
      }

      return () => {
        clearInterval(checkBombTimer);
      };
    }
  }, []);

  // 닉네임 유효성 및 욕설 탐지 함수
  const validateNickname = (val: string): string => {
    if (!val) return '이름을 입력해 주세요.';
    if (val.length < 2 || val.length > 6) return '닉네임은 2자 이상 6자 이하여야 합니다.';

    if (val.trim() === '선생님') {
      return "'선생님'은 학생 닉네임으로 사용할 수 없습니다.";
    }

    // 완성형 한글, 영문, 숫자 조합만 허용 (초성 'ㄱ-ㅎ', 모음 'ㅏ-ㅣ', 특수문자, 공백 완전 차단)
    const regex = /^[가-힣a-zA-Z0-9]+$/;
    if (!regex.test(val)) {
      return '완성된 한글, 영문, 숫자만 가능합니다. (초성/특수문자/공백 금지)';
    }

    // 비속어 차단 매칭
    const hasBadWord = BAD_WORDS.some(word => val.includes(word));
    if (hasBadWord) {
      return '욕설이나 비속어는 사용할 수 없습니다.';
    }

    return ''; // 이상 없음
  };

  // 실시간 변경 핸들러
  const handleNicknameChange = (val: string) => {
    setNickname(val);
    if (val === '') {
      setNicknameError('');
    } else {
      setNicknameError(validateNickname(val));
    }
  };

  // 6자리 무작위 방 번호 생성
  const generateRoomCode = () => {
    return Math.floor(100000 + Math.random() * 900000).toString();
  };

  // 1-1. 교사 - 만료된 방 복귀 차단 및 유효성 검사 핸들러
  const handleRejoinRoom = async () => {
    if (!activeHostRoom) return;
    sessionStorage.setItem("luckypang_is_teacher", "true");
    sessionStorage.setItem("luckypang_nickname", "선생님");
    router.push(`/room/${activeHostRoom.code}`);
  };

  // 1. 교사 - 퀴즈방 생성 핸들러 (PeerJS 기반)
  const handleCreateRoom = async () => {
    setLoading(true);
    const code = generateRoomCode();
    const statusMeta = `waiting:${totalRounds}:${difficulty}:${ratio}`;

    try {
      if (typeof window !== "undefined") {
        sessionStorage.setItem("luckypang_is_teacher", "true");
        sessionStorage.setItem("luckypang_nickname", "선생님");
        sessionStorage.setItem("luckypang_init_mode", gameMode);
        sessionStorage.setItem("luckypang_init_status", statusMeta);
      }
      setTimeout(() => {
        router.push(`/room/${code}`);
      }, 150);
    } catch (err) {
      setLoading(false);
      console.error("방 생성 중 오류 발생:", err);
      appAlert("방 생성에 실패했습니다.");
    }
  };

  // 2. 학생 - 방 입장 핸들러 (PeerJS 기반)
  const handleJoinRoom = async () => {
    if (!enterCode.trim() || !nickname.trim()) {
      appAlert("방 번호와 닉네임을 입력해 주세요!");
      return;
    }

    // 닉네임 최종 이중 검증
    const error = validateNickname(nickname);
    if (error) {
      appAlert(error);
      return;
    }

    setLoading(true);
    sessionStorage.setItem("luckypang_is_teacher", "false");
    sessionStorage.setItem("luckypang_nickname", nickname.trim());

    setTimeout(() => {
      router.push(`/room/${enterCode.trim()}`);
    }, 150);
  };

  if (!isClient) return null;

  return (
    <div className="flex flex-col items-center justify-center min-h-screen bg-cream px-4 py-8 relative">
      {/* ── [A. 랜딩 메인 화면 뷰 (타자팡 스타일 1:1 매칭)] ── */}
      {viewMode === "landing" ? (
        <div className="w-full max-w-md flex flex-col items-center gap-5 my-auto">
          {/* 1. 대형 히어로 카툰 이미지 카드 */}
          <div className="w-full bg-white border-4 border-black rounded-[32px] p-2.5 shadow-[5px_5px_0px_0px_rgba(0,0,0,1)] overflow-hidden relative">
            <div className="relative w-full rounded-[22px] overflow-hidden border-2 border-black bg-slate-50 flex items-center justify-center">
              {/* 메인 3D 카툰 배너 이미지 (잘림 없이 전체 풀사이즈 노출) */}
              <img
                src="/luckypang_5_1_2_pt.webp"
                alt="Lucky Pang Hero Banner"
                className="w-full h-auto max-h-[420px] object-contain block rounded-[20px]"
              />
            </div>
          </div>

          {/* 2. 메인 타이틀 박스 */}
          <div className="w-full bg-[#eef5fc] border-3 border-black rounded-2xl p-4 text-center shadow-[4px_4px_0px_0px_rgba(0,0,0,1)] flex flex-col items-center gap-1">
            <h2 className="text-2xl md:text-3xl font-black text-black tracking-tight flex items-center justify-center gap-2">
              <span>럭키팡</span>
              <span className="text-gray-400 font-normal">|</span>
              <span className="text-indigo-600">수학 약수와 배수 편</span>
            </h2>
            <p className="text-xs md:text-sm font-bold text-gray-600 mt-1 break-keep">
              친구들과 함께 즐기는 실시간 약수와 배수 퀴즈 & 럭키 추첨 레이스!
            </p>
          </div>

          {/* 3. 주요 버튼 2개 */}
          <div className="w-full flex flex-col gap-3.5 mt-1">
            {/* 시작하기! 버튼 (로비 이동) */}
            <button
              onClick={() => setViewMode("lobby")}
              className="w-full py-4 bg-[#d1fae5] hover:bg-emerald-300 text-slate-950 font-black text-2xl md:text-3xl border-3 border-black rounded-2xl shadow-[4px_4px_0px_0px_rgba(0,0,0,1)] active:translate-x-0.5 active:translate-y-0.5 transition-all cursor-pointer flex items-center justify-center gap-2"
            >
              <span>시작하기!</span>
              <span className="text-2xl">🚀</span>
            </button>

            {/* 사용 안내 버튼 (팝업 오픈) */}
            <button
              onClick={() => setShowGuideModal(true)}
              className="w-full py-4 bg-[#ffe4e6] hover:bg-pink-300 text-slate-950 font-black text-2xl md:text-3xl border-3 border-black rounded-2xl shadow-[4px_4px_0px_0px_rgba(0,0,0,1)] active:translate-x-0.5 active:translate-y-0.5 transition-all cursor-pointer flex items-center justify-center gap-2"
            >
              <span>사용 안내</span>
              <span className="text-2xl">📖</span>
            </button>
          </div>
        </div>
      ) : (
        /* ── [B. 로비 게임방 개설 / 참여 뷰] ── */
        <div className="w-full max-w-4xl flex flex-col items-center gap-6">
          {/* 상단 네비게이션 헤더 */}
          <div className="w-full flex items-center justify-between border-b-2 border-dashed border-gray-300 pb-3 mb-1">
            <button
              onClick={() => setViewMode("landing")}
              className="px-3.5 py-1.5 bg-white hover:bg-gray-100 border-2 border-black rounded-xl text-xs md:text-sm font-black text-black shadow-[2px_2px_0px_0px_rgba(0,0,0,1)] active:translate-x-0.5 active:translate-y-0.5 transition-all cursor-pointer flex items-center gap-1"
            >
              <span>🏠</span> 메인으로
            </button>
            <div className="text-right">
              <h1 className="text-xl md:text-2xl font-black text-black">🍀 럭키팡 게임 로비 🍀</h1>
              <p className="text-[11px] font-bold text-gray-500">5학년 1학기 [약수와 배수]</p>
            </div>
          </div>

          {/* 기존 로비 카드 컨테이너 (교사 개설 / 학생 참가) */}
          <div className="w-full max-w-4xl flex flex-col md:flex-row gap-8 items-stretch">
            {/* 1. 교사용 방 생성 카드 */}
            <div className="flex-1 bg-white neo-box p-6 md:p-8 flex flex-col justify-between items-center text-center">
              <div className="w-full flex flex-col items-center">
                <span className="text-4xl mb-3">🧑‍🏫</span>
                <h2 className="text-4xl font-black text-black">선생님 메뉴</h2>
                {activeHostRoom && (
                  <div className="w-full mt-3 bg-yellow-100 border-2 border-black rounded-xl p-3 shadow-[1.5px_1.5px_0px_0px_rgba(0,0,0,1)] flex flex-col items-center gap-1.5 animate-pulse">
                    <span className="text-[10px] font-black text-yellow-800">📡 진행 중이던 게임방이 있습니다.</span>
                    <div className="flex gap-2 w-full">
                      <button
                        onClick={handleRejoinRoom}
                        disabled={loading}
                        className="flex-1 py-1.5 bg-yellow-400 border-2 border-black rounded-lg text-xs font-black text-black shadow-[1px_1px_0px_0px_rgba(0,0,0,1)] hover:-translate-y-0.5 transition-all cursor-pointer disabled:opacity-50"
                      >
                        {loading ? "방 확인 중..." : `방 [${activeHostRoom.code}]로 복귀`}
                      </button>
                      <button
                        onClick={async () => {
                          if (await appConfirm("이 방 정보를 삭제하고 새 방을 만드시겠습니까?")) {
                            localStorage.removeItem("luckypang_host_active_room");
                            setActiveHostRoom(null);
                          }
                        }}
                        className="px-2.5 py-1.5 bg-pink border-2 border-black rounded-lg text-xs font-black text-red-900 shadow-[1px_1px_0px_0px_rgba(0,0,0,1)] hover:-translate-y-0.5 transition-all cursor-pointer"
                        title="이 방 복귀 기록 지우기"
                      >
                        🗑️ 닫기
                      </button>
                    </div>
                  </div>
                )}
                <p className="text-m font-bold text-gray-500 mt-2.5 break-keep">
                  칠판/빔프로젝터에 띄워 놓을 게임방을 개설합니다.
                </p>

                {/* 모드 선택 섹션 */}
                <div className="w-full bg-cream border-2 border-black rounded-2xl p-4 my-6 shadow-[2px_2px_0px_0px_rgba(0,0,0,1)] flex flex-col gap-2">
                  <span className="text-m font-black text-center text-gray-600 block">
                    ⚙️ 게임 운영 모드 선택
                  </span>

                  <div className="flex gap-2">
                    <button
                      onClick={() => setGameMode("standard")}
                      className={`flex-1 py-2 text-base font-black rounded-lg border-2 border-black transition-all ${gameMode === "standard"
                        ? "bg-sky shadow-[1px_1px_0px_0px_rgba(0,0,0,1)] scale-102"
                        : "bg-white text-gray-400"
                        }`}
                    >
                      기본 모드
                    </button>
                    <button
                      onClick={() => setGameMode("extreme")}
                      className={`flex-1 py-2 text-base font-black rounded-lg border-2 border-black transition-all ${gameMode === "extreme"
                        ? "bg-lemon shadow-[1px_1px_0px_0px_rgba(0,0,0,1)] scale-102"
                        : "bg-white text-gray-400"
                        }`}
                    >
                      익스트림 모드<br />(럭키티켓모드)
                    </button>
                  </div>
                  <p className="text-[14px] text-gray-500 font-bold text-center leading-normal mt-1.5 break-keep whitespace-pre-line">
                    {gameMode === "standard"
                      ? "💡 정답 수에 따라 정직한 등수가 실시간 누적됩니다."
                      : "🔥 게임 완료 후, 획득한 티켓들로 보너스 당첨번호를\n추첨하여 큰 순위 역전을 일으킵니다."}
                  </p>
                </div>
              </div>

              <button
                onClick={handleCreateRoom}
                className="w-full py-4 bg-lemon text-black font-black text-2xl neo-btn cursor-pointer"
              >
                🎮 퀴즈 게임방 만들기
              </button>
            </div>

            {/* 2. 학생용 참가 카드 */}
            <div className="flex-1 bg-white neo-box p-6 md:p-8 flex flex-col justify-between items-center">
              <div className="w-full flex flex-col items-center">
                <span className="text-4xl mb-3">🎒</span>
                <h2 className="text-4xl font-black text-black">학생 참여</h2>
                <p className="text-m font-bold text-gray-500 mt-1 text-center break-keep">
                  선생님이 알려주신 방 번호와 내 이름으로 참가합니다.
                </p>

                {/* 입력 폼 필드 리스트 */}
                <div className="w-full flex flex-col gap-3 my-6">
                  <div className="flex flex-col gap-1.5">
                    <label className="text-m font-black text-gray-600">방 번호 (6자리)</label>
                    <input
                      type="text"
                      inputMode="numeric"
                      pattern="[0-9]*"
                      maxLength={6}
                      placeholder="예: 582910"
                      value={enterCode}
                      onChange={(e) => setEnterCode(e.target.value.replace(/[^0-9]/g, ""))}
                      className="w-full p-3 font-bold border-2 border-black rounded-xl focus:outline-none focus:bg-cream text-black"
                    />
                  </div>

                  <div className="flex flex-col gap-1.5 w-full">
                    <label className="text-m font-black text-gray-600">이름 (닉네임)</label>
                    <input
                      type="text"
                      lang="ko"
                      autoComplete="off"
                      autoCapitalize="none"
                      spellCheck="false"
                      placeholder="예: 홍길동"
                      value={nickname}
                      onChange={(e) => handleNicknameChange(e.target.value)}
                      style={{ imeMode: 'active' }}
                      className={`w-full p-3 font-bold border-2 rounded-xl focus:outline-none focus:bg-cream text-black ${nicknameError ? 'border-rose-500 focus:border-rose-500' : 'border-black'
                        }`}
                    />
                    {/* 에러 영역 공간 고정 예약 */}
                    <div className="h-5 flex items-center mt-1 w-full">
                      {nicknameError ? (
                        <span className="text-xs font-bold text-rose-600 animate-pulse">
                          ⚠️ {nicknameError}
                        </span>
                      ) : (
                        <span className="text-xs select-none text-transparent">Placeholder</span>
                      )}
                    </div>
                  </div>
                </div>
              </div>

              <button
                onClick={handleJoinRoom}
                className="w-full py-4 bg-sky text-black font-black text-2xl neo-btn cursor-pointer"
              >
                🚀 게임방 입장하기
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── [C. 사용 안내 팝업 모달] ── */}
      {showGuideModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 animate-in fade-in duration-200">
          <div className="w-full max-w-lg bg-cream border-4 border-black rounded-3xl p-6 md:p-7 shadow-[6px_6px_0px_0px_rgba(0,0,0,1)] flex flex-col gap-5 max-h-[90vh] overflow-y-auto">
            {/* 모달 헤더 */}
            <div className="flex justify-between items-center border-b-3 border-black pb-3">
              <h3 className="text-2xl font-black text-black flex items-center gap-2">
                <span>📖</span> 럭키팡 사용 안내
              </h3>
              <button
                onClick={() => setShowGuideModal(false)}
                className="w-8 h-8 rounded-full bg-white border-2 border-black text-black font-black text-base flex items-center justify-center shadow-[1.5px_1.5px_0px_0px_rgba(0,0,0,1)] hover:bg-gray-100 cursor-pointer"
              >
                ✕
              </button>
            </div>

            {/* 모달 본문 */}
            <div className="flex flex-col gap-4 text-slate-800 text-sm font-bold leading-relaxed">
              {/* 선생님 이용법 */}
              <div className="bg-amber-100 border-2 border-black rounded-2xl p-4 shadow-[2px_2px_0px_0px_rgba(0,0,0,1)] flex flex-col gap-2">
                <span className="text-base font-black text-black flex items-center gap-1.5">
                  🧑‍🏫 선생님 (퀴즈 개설 및 진행)
                </span>
                <ol className="list-decimal list-inside space-y-1.5 text-xs md:text-sm font-bold text-slate-800">
                  <li>메인 화면에서 <b>[시작하기!]</b> ➔ <b>[🎮 퀴즈 게임방 만들기]</b>를 누릅니다.</li>
                  <li>수업 목적에 맞게 <b>기본 모드</b> 또는 <b>익스트림 모드</b>를 선택합니다.</li>
                  <li>생성된 <b>6자리 방 번호</b>를 칠판이나 빔프로젝터에 공유합니다.</li>
                  <li>학생 입장 완료 후 퀴즈를 시작하고 <b>행운 규칙 추첨 버튼</b>으로 진행합니다.</li>
                </ol>
              </div>

              {/* 학생 이용법 */}
              <div className="bg-sky/60 border-2 border-black rounded-2xl p-4 shadow-[2px_2px_0px_0px_rgba(0,0,0,1)] flex flex-col gap-2">
                <span className="text-base font-black text-black flex items-center gap-1.5">
                  🎒 학생 (게임 참여)
                </span>
                <ol className="list-decimal list-inside space-y-1.5 text-xs md:text-sm font-bold text-slate-800">
                  <li>선생님이 알려주신 <b>6자리 방 번호</b>와 <b>이름(닉네임)</b>을 입력합니다.</li>
                  <li>퀴즈를 바르게 풀어 정답 점수와 <b>럭키 티켓</b>을 획득합니다.</li>
                  <li>선생님의 <b>행운 규칙 추첨</b> 결과에 따라 티켓 보너스 역전 포인트를 얻습니다!</li>
                </ol>
              </div>

              {/* 🧩 출제 문제 유형 안내 */}
              <div className="bg-emerald-100/90 border-2 border-black rounded-2xl p-4 shadow-[2px_2px_0px_0px_rgba(0,0,0,1)] flex flex-col gap-2.5">
                <span className="text-base font-black text-slate-900 flex items-center gap-1.5">
                  🧩 5학년 [약수와 배수] 출제 문제 유형
                </span>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs font-bold text-slate-800">
                  <div className="bg-white border border-black rounded-xl p-2.5 shadow-[1px_1px_0px_0px_rgba(0,0,0,1)]">
                    <span className="text-blue-600 font-black block">1. 약수 구하기 🩵</span>
                    어떤 수를 나누어떨어지게 하는 약수 찾기
                  </div>
                  <div className="bg-white border border-black rounded-xl p-2.5 shadow-[1px_1px_0px_0px_rgba(0,0,0,1)]">
                    <span className="text-amber-600 font-black block">2. 배수 구하기 🟡</span>
                    어떤 수를 1배, 2배, 3배... 한 배수 찾기
                  </div>
                  <div className="bg-white border border-black rounded-xl p-2.5 shadow-[1px_1px_0px_0px_rgba(0,0,0,1)]">
                    <span className="text-pink-600 font-black block">3. 공약수 & 최대공약수 🩷</span>
                    두 수의 공통된 약수와 가장 큰 공약수 구하기
                  </div>
                  <div className="bg-white border border-black rounded-xl p-2.5 shadow-[1px_1px_0px_0px_rgba(0,0,0,1)]">
                    <span className="text-purple-600 font-black block">4. 공배수 & 최소공배수 🟣</span>
                    두 수의 공통된 배수와 가장 작은 공배수 구하기
                  </div>
                </div>
                <div className="bg-white/90 border border-black rounded-xl p-2.5 text-xs text-slate-800 font-bold flex flex-col gap-1.5 mt-0.5">
                  <span className="font-black text-slate-900">🎟️ 럭키 티켓 & 💣 오답 트랩 포인트</span>
                  <p>• <b>럭키 정답 카드(🎟️)</b>를 맞히면 숫자가 적힌 티켓을 모아 마지막 행운 규칙 역전 추첨에 사용합니다!</p>
                  <p>• <b>함정 오답 카드(💣)</b>를 조심하세요! 감점이 있는 오답 카드가 포함되어 있습니다.</p>
                </div>
              </div>

              {/* 특징 요약 */}
              <div className="bg-lemon border-2 border-black rounded-2xl p-4 shadow-[2px_2px_0px_0px_rgba(0,0,0,1)] flex flex-col gap-1 text-xs md:text-sm">
                <span className="font-black text-black">💡 럭키팡의 특징</span>
                <p className="text-yellow-950 font-bold">
                  초등 5학년 1학기 [약수와 배수] 단원 특화 퀴즈로, 마지막 행운 규칙 추첨을 통해 누구나 역전 가능한 즐거운 실시간 학습 게임입니다.
                </p>
              </div>
            </div>

            {/* 닫기 버튼 */}
            <button
              onClick={() => setShowGuideModal(false)}
              className="w-full py-3.5 bg-black text-white font-black text-lg rounded-2xl shadow-[3px_3px_0px_0px_rgba(100,100,100,1)] hover:bg-gray-800 transition-all cursor-pointer mt-1"
            >
              확인하였습니다 👍
            </button>
          </div>
        </div>
      )}

      {/* 최소 노출 보장형 로딩 오버레이 */}
      {loading && (
        <div className="fixed inset-0 z-50 flex flex-col items-center justify-center bg-white/90 backdrop-blur-sm p-6 animate-in fade-in duration-200">
          <style>{`
            @keyframes barFlow {
              0% { background-position: 0 0; }
              100% { background-position: 40px 0; }
            }
            @keyframes bounceSubtle {
              0%, 100% { transform: translateY(0); }
              50% { transform: translateY(-8px); }
            }
            .animate-bar-flow {
              background-image: linear-gradient(
                45deg,
                #6366f1 25%,
                #4f46e5 25%,
                #4f46e5 50%,
                #6366f1 50%,
                #6366f1 75%,
                #4f46e5 75%,
                #4f46e5 100%
              );
              background-size: 40px 40px;
              animation: barFlow 1s linear infinite;
            }
            .animate-bounce-subtle {
              animation: bounceSubtle 1.2s ease-in-out infinite;
            }
          `}</style>

          {/* 귀여운 바운싱 🍀 이모지 로고 */}
          <div className="text-5xl mb-4 animate-bounce-subtle select-none">🍀</div>

          {/* 흐르는 빗금 로딩 카드 */}
          <div className="w-full max-w-[280px] bg-slate-100 border-4 border-black p-4 rounded-2xl shadow-[4px_4px_0px_#000] text-center">
            <p className="font-black text-slate-800 text-sm mb-3">연결 중입니다...</p>

            {/* 빗금 프로그레스 바 */}
            <div className="w-full h-6 border-4 border-black rounded-full overflow-hidden bg-white shadow-[2px_2px_0px_rgba(0,0,0,0.15)_inset]">
              <div className="h-full w-full animate-bar-flow" />
            </div>

            <p className="text-[10px] font-bold text-slate-500 mt-2">잠시만 기다려 주세요!</p>
          </div>
        </div>
      )}
    </div>
  );
}
