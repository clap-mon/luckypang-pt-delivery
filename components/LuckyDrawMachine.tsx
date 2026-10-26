"use client";

import React, { useState, useEffect, useMemo, useRef } from "react";
import {
  generateMathMissions,
  MathMission,
  calculateMissionPoints,
  calculateSingleTicketBonus,
} from "../lib/mathEngine";

interface Ticket {
  numbers: number[];
}

interface StudentItem {
  id: string;
  nickname: string;
  tickets?: Ticket[] | any;
  score?: number;
}

interface LuckyDrawMachineProps {
  winningNumbers: number[]; // 시드 유지를 위한 메타 파라미터
  myTickets: Ticket[];
  onFinishDraw: (bonusScore: number) => void;
  roomCode?: string;
  isHost?: boolean;
  allPlayers?: StudentItem[];
  revealedCount?: number;
  onRevealedCountChange?: (count: number) => void;
}

export default function LuckyDrawMachine({
  winningNumbers,
  myTickets,
  onFinishDraw,
  roomCode = "default",
  isHost = false,
  allPlayers = [],
  revealedCount: propRevealedCount,
  onRevealedCountChange,
}: LuckyDrawMachineProps) {
  // 1. 방 코드를 바탕으로 4가지 수학 미션 조건 획득
  const missions = useMemo(() => {
    return generateMathMissions(roomCode);
  }, [roomCode]);

  const [internalCount, setInternalCount] = useState<number>(propRevealedCount ?? 0);
  const [isRolling, setIsRolling] = useState(false);
  const hasCalledFinished = useRef(false);
  const prevStudentCountRef = useRef(propRevealedCount ?? 0);

  // 부모에서 내려준 propRevealedCount가 변경되면 내부 상태 동기화 (초기화나 외부 제어 시)
  useEffect(() => {
    if (propRevealedCount !== undefined) {
      setInternalCount(propRevealedCount);
    }
  }, [propRevealedCount]);

  // 실제 화면에 적용되는 공개 개수
  const revealedCount = isHost ? internalCount : (propRevealedCount ?? 0);

  // 교사 카운트 변경 헬퍼 (변경 시 부모의 onRevealedCountChange 호출)
  const updateRevealedCount = (nextVal: number) => {
    setInternalCount(nextVal);
    if (onRevealedCountChange) {
      onRevealedCountChange(nextVal);
    }
  };

  // 2. 교사 수동/자동 추첨 컨트롤 핸들러
  const handleRevealNext = () => {
    if (revealedCount >= 4 || isRolling) return;
    setIsRolling(true);
    const nextCount = Math.min(revealedCount + 1, 4);
    updateRevealedCount(nextCount);
    setTimeout(() => {
      setIsRolling(false);
    }, 600);
  };

  const handleAutoRevealAll = () => {
    if (revealedCount >= 4 || isRolling) return;
    setIsRolling(true);

    let current = revealedCount;
    const autoTimer = setInterval(() => {
      if (current < 4) {
        current++;
        updateRevealedCount(current);
      } else {
        clearInterval(autoTimer);
        setIsRolling(false);
      }
    }, 1200);
  };

  const handleResetDraw = () => {
    updateRevealedCount(0);
    setIsRolling(false);
    hasCalledFinished.current = false;
  };

  // 학생 뷰 전용: 교사가 공개할 때마다 시각적 롤링 효과 연출
  useEffect(() => {
    if (!isHost) {
      const currentCount = propRevealedCount ?? 0;
      if (currentCount > prevStudentCountRef.current) {
        setIsRolling(true);
        const timer = setTimeout(() => {
          setIsRolling(false);
        }, 600);
        prevStudentCountRef.current = currentCount;
        return () => clearTimeout(timer);
      }
      prevStudentCountRef.current = currentCount;
    }
  }, [propRevealedCount, isHost]);

  // 현재까지 공개된 미션 리스트
  const activeMissions = useMemo(() => {
    return missions.slice(0, revealedCount);
  }, [missions, revealedCount]);

  // 4-A. 학생 전용: 내 티켓 숫자들이 공개된 미션에 부합하는지 대조
  const matchResults = useMemo(() => {
    let totalBonusScore = 0;

    const list = myTickets.map((ticket, tIdx) => {
      const parsedNumbers = Array.isArray(ticket.numbers) ? ticket.numbers : [];
      const numberAnalysis = parsedNumbers.map((num) => {
        const passedMissions = activeMissions.filter((m) => m.check(num));
        return {
          num,
          passedMissions,
        };
      });

      const { clearedCount, score } = calculateSingleTicketBonus(activeMissions, parsedNumbers);
      totalBonusScore += score;

      return {
        ticketIndex: tIdx,
        numbers: parsedNumbers,
        numberAnalysis,
        clearedCount,
        score,
      };
    });

    return { list, totalBonusScore };
  }, [myTickets, activeMissions]);

  // 4-B. 교사 전용: 우리 반 모든 학생들의 티켓 보너스 점수 실시간 연산
  const studentsBonusSummary = useMemo(() => {
    if (!isHost || !allPlayers) return [];

    return allPlayers.map((player) => {
      const rawTickets = player.tickets || [];
      const ticketList: Ticket[] = Array.isArray(rawTickets) ? rawTickets : [];

      let totalStudentBonus = 0;
      let maxCleared = 0;

      ticketList.forEach((t) => {
        const nums = Array.isArray(t.numbers) ? t.numbers : [];
        const { clearedCount, score } = calculateSingleTicketBonus(activeMissions, nums);
        if (clearedCount > maxCleared) maxCleared = clearedCount;
        totalStudentBonus += score;
      });

      return {
        id: player.id,
        nickname: player.nickname,
        ticketCount: ticketList.length,
        maxClearedCount: maxCleared,
        bonusScore: totalStudentBonus,
      };
    }).sort((a, b) => b.bonusScore - a.bonusScore);
  }, [isHost, allPlayers, activeMissions]);

  const isAllRevealed = revealedCount === 4;

  // 5. 판정 종료 후 최종 보너스 포인트 수여 콜백
  useEffect(() => {
    if (isAllRevealed && !hasCalledFinished.current) {
      const timer = setTimeout(() => {
        if (!hasCalledFinished.current) {
          hasCalledFinished.current = true;
          onFinishDraw(matchResults.totalBonusScore);
        }
      }, 3500);
      return () => clearTimeout(timer);
    }
  }, [isAllRevealed, matchResults.totalBonusScore, onFinishDraw]);

  return (
    <div className="w-full max-w-2xl bg-cream neo-box p-6 md:p-8 flex flex-col items-center">
      {/* 교사 전용 행운 규칙 추첨 컨트롤 패널 */}
      {isHost && (
        <div className="w-full bg-amber-100 border-3 border-black rounded-2xl p-4 mb-5 shadow-[3px_3px_0px_0px_rgba(0,0,0,1)] flex flex-col sm:flex-row items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <span className="text-sm font-black text-slate-900">🎓 교사 추첨 컨트롤러</span>
            <span className="text-xs bg-white border border-black px-2 py-0.5 rounded-full font-black text-slate-800">
              {revealedCount} / 4 공개됨
            </span>
          </div>
          <div className="flex items-center gap-2 w-full sm:w-auto">
            <button
              disabled={revealedCount >= 4 || isRolling}
              onClick={handleRevealNext}
              className="flex-1 sm:flex-none px-3 py-1.5 bg-sky hover:bg-sky-400 disabled:opacity-50 text-blue-950 border-2 border-black rounded-xl font-black text-xs shadow-[2px_2px_0px_0px_rgba(0,0,0,1)] active:translate-x-0.5 active:translate-y-0.5 transition-all cursor-pointer"
            >
              ▶️ 한 개씩 추첨 (수동)
            </button>
            <button
              disabled={revealedCount >= 4 || isRolling}
              onClick={handleAutoRevealAll}
              className="flex-1 sm:flex-none px-3 py-1.5 bg-lemon hover:bg-yellow-300 disabled:opacity-50 text-yellow-950 border-2 border-black rounded-xl font-black text-xs shadow-[2px_2px_0px_0px_rgba(0,0,0,1)] active:translate-x-0.5 active:translate-y-0.5 transition-all cursor-pointer"
            >
              ⚡ 한 번에 자동 추첨
            </button>
            {revealedCount > 0 && (
              <button
                onClick={handleResetDraw}
                className="px-2 py-1.5 bg-gray-200 hover:bg-gray-300 text-gray-800 border-2 border-black rounded-xl font-black text-xs shadow-[1.5px_1.5px_0px_0px_rgba(0,0,0,1)] cursor-pointer"
                title="추첨 초기화"
              >
                🔄
              </button>
            )}
          </div>
        </div>
      )}

      {/* 타이틀 및 현황판 */}
      <div className="bg-lemon border-2 border-black rounded-2xl py-3 px-6 mb-6 shadow-[3px_3px_0px_0px_rgba(0,0,0,1)] text-center">
        <h3 className="text-xl md:text-2xl font-black text-black tracking-wide flex items-center justify-center gap-2">
          <span>🎯</span> 럭키팡 티켓 추첨 <span>🎯</span>
        </h3>
        <p className="text-sm font-bold mt-1 text-black">
          {!isAllRevealed
            ? isHost
              ? "상단 컨트롤러로 행운 규칙을 추첨해 보세요!"
              : revealedCount === 0
              ? "선생님이 행운 규칙을 추첨할 때까지 잠시 기다려주세요...!"
              : "약수와 배수 행운 규칙 티켓이 순차 공개되고 있습니다...!"
            : "🎉 모든 티켓 추첨확인이 완료되었습니다! 🎉"}
        </p>
      </div>

      {/* 4가지 행운 규칙 공개 카드 영역 */}
      <div className="w-full bg-white border-4 border-black rounded-3xl p-5 mb-6 shadow-[4px_4px_0px_0px_rgba(0,0,0,1)] flex flex-col gap-4">
        <span className="text-xs font-black text-gray-500 border-b-2 border-dashed border-gray-200 pb-2 flex items-center justify-between">
          <span>📚 5학년 [약수와 배수] 행운 규칙 (4가지)</span>
          <span className="text-[10px] text-gray-400">공개 진행: {revealedCount} / 4</span>
        </span>

        {/* 4개 미션 카드 그리드 */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 w-full">
          {missions.map((mission, idx) => {
            const isRevealed = revealedCount > idx;

            let badgeBg = "bg-sky text-blue-950 border-blue-500";
            if (mission.badgeColor === "lemon") badgeBg = "bg-lemon text-yellow-950 border-yellow-500";
            if (mission.badgeColor === "pink") badgeBg = "bg-pink text-pink-950 border-pink-500";
            if (mission.badgeColor === "purple") badgeBg = "bg-purple-100 text-purple-950 border-purple-400";

            return (
              <div
                key={mission.id}
                className={`border-3 border-black rounded-2xl p-3.5 flex items-center justify-between shadow-[2px_2px_0px_0px_rgba(0,0,0,1)] transition-all duration-300 ${isRevealed
                  ? `${badgeBg} scale-102`
                  : "bg-gray-100 text-gray-400 border-dashed opacity-60"
                  }`}
              >
                <div className="flex items-center gap-2">
                  <span className="w-6 h-6 rounded-full bg-black text-white text-xs font-black flex items-center justify-center shrink-0">
                    {idx + 1}
                  </span>
                  <span className="text-sm font-black tracking-tight leading-snug">
                    {isRevealed ? mission.title : "행운 규칙 공개 중..."}
                  </span>
                </div>

                {!isRevealed && (
                  <span className="text-xs animate-pulse">⏳</span>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* 교사 뷰 vs 학생 뷰 분기 렌더링 */}
      {isHost ? (
        /* 교사 뷰: 우리 반 학생들 실시간 티켓 보너스 획득 현황 패널 */
        <div className="w-full flex flex-col gap-3">
          <h4 className="text-base md:text-lg font-black text-black self-start flex items-center gap-2">
            <span>🎓 우리 반 학생들 실시간 티켓 보너스 획득 현황</span>
            <span className="text-xs bg-sky border border-black px-2.5 py-0.5 rounded-full font-black">
              {studentsBonusSummary.length}명 참여 중
            </span>
          </h4>

          {studentsBonusSummary.length === 0 ? (
            <div className="bg-white border-2 border-dashed border-gray-400 rounded-xl p-6 text-center text-sm font-bold text-gray-500 shadow-[2px_2px_0px_rgba(0,0,0,1)]">
              현재 참여 중인 학생 플레이어가 없습니다.
            </div>
          ) : (
            <div className="max-h-72 overflow-y-auto grid grid-cols-1 sm:grid-cols-2 gap-3 pr-1">
              {studentsBonusSummary.map((st, idx) => (
                <div
                  key={st.id || idx}
                  className={`border-3 border-black rounded-2xl p-3.5 flex items-center justify-between shadow-[2.5px_2.5px_0px_rgba(0,0,0,1)] transition-all ${
                    st.bonusScore > 0 ? "bg-amber-50/90 border-yellow-500 shadow-[3px_3px_0px_rgba(0,0,0,1)] scale-101" : "bg-white"
                  }`}
                >
                  <div className="flex items-center gap-2.5">
                    <span className="w-7 h-7 rounded-full bg-slate-900 text-white text-xs font-black flex items-center justify-center shrink-0 border border-black">
                      {idx + 1}
                    </span>
                    <div className="flex flex-col">
                      <span className="text-sm md:text-base font-black text-slate-900 tracking-tight">{st.nickname}</span>
                      <span className="text-[11px] font-bold text-slate-500">🎫 보유 티켓: {st.ticketCount}장</span>
                    </div>
                  </div>

                  <div>
                    {st.bonusScore > 0 ? (
                      <span className="bg-lemon text-yellow-950 border-2 border-black font-black text-xs md:text-sm px-3 py-1 rounded-xl shadow-[1px_1px_0px_rgba(0,0,0,1)] animate-pulse">
                        🎯 +{st.bonusScore}점
                      </span>
                    ) : (
                      <span className="text-gray-400 text-xs font-bold bg-gray-100 px-2.5 py-1 rounded-lg border border-gray-300">
                        +0점
                      </span>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      ) : (
        /* 학생 뷰: 내 티켓 실시간 추첨 결과 리스트 */
        <div className="w-full flex flex-col gap-3">
          <h4 className="text-base md:text-lg font-black text-black self-start">
            📝 내 티켓 실시간 추첨 결과 ({myTickets.length}장)
          </h4>

          {myTickets.length === 0 ? (
            <div className="bg-white border-2 border-dashed border-gray-400 rounded-xl p-5 text-center text-sm font-bold text-gray-500 shadow-[2px_2px_0px_rgba(0,0,0,1)]">
              획득한 럭키팡 티켓이 없어 추첨에 참여할 수 없습니다. 😭
            </div>
          ) : (
            <div className="max-h-72 overflow-y-auto flex flex-col gap-3 pr-1">
              {matchResults.list.map((result) => (
                <div
                  key={result.ticketIndex}
                  className={`bg-white border-3 border-black rounded-2xl p-4 flex flex-col gap-2.5 shadow-[3px_3px_0px_0px_rgba(0,0,0,1)] transition-all duration-300 ${result.score > 0 ? "border-yellow-400 bg-amber-50/40" : ""
                    }`}
                >
                  {/* 상단 티켓 헤더 및 미션 달성 점수 배지 */}
                  <div className="flex justify-between items-center border-b border-dashed border-gray-200 pb-2">
                    <span className="text-xs font-black text-slate-800 bg-white px-2.5 py-1 border-2 border-black rounded-lg shadow-[1px_1px_0px_rgba(0,0,0,1)]">
                      🎟️ 티켓 #{result.ticketIndex + 1}
                    </span>
                    {result.score > 0 ? (
                      <span className="bg-lemon text-yellow-950 border-2 border-black font-black text-xs px-3 py-1 rounded-xl shadow-[1px_1px_0px_0px_rgba(0,0,0,1)] animate-pulse">
                        🎯 {result.clearedCount}개 규칙 성공! (+{result.score}점 보너스!)
                      </span>
                    ) : (
                      <span className="text-gray-400 text-xs font-bold">
                        {result.clearedCount}개 규칙 일치
                      </span>
                    )}
                  </div>

                  {/* 내 티켓 6개 숫자 카드 및 적용된 미션 스티커 대조 표시 */}
                  <div className="grid grid-cols-3 sm:grid-cols-6 gap-2 w-full">
                    {result.numberAnalysis.map((item, nIdx) => {
                      const hasPassed = item.passedMissions.length > 0;
                      return (
                        <div
                          key={nIdx}
                          className={`flex flex-col items-center justify-between border-2 border-black rounded-xl p-1.5 min-h-[58px] transition-all ${hasPassed
                            ? "bg-lemon/90 border-2 shadow-[1px_1px_0px_rgba(0,0,0,1)] scale-102"
                            : "bg-gray-50 text-gray-400"
                            }`}
                        >
                          <span className={`text-base font-black ${hasPassed ? "text-black" : "text-gray-400"}`}>
                            {item.num}
                          </span>

                          {hasPassed ? (
                            <div className="flex flex-col gap-0.5 w-full items-center">
                              {item.passedMissions.map((m) => (
                                <span
                                  key={m.id}
                                  className="bg-sky text-blue-950 border border-black text-[8px] font-black px-1 rounded w-full text-center truncate"
                                  title={m.title}
                                >
                                  M{m.id} 통과
                                </span>
                              ))}
                            </div>
                          ) : (
                            <span className="text-[8px] text-gray-300 font-bold">미해당</span>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* 최종 추첨 완료 후 축하 안내 핑크 패널 (교사 뷰 vs 학생 뷰 분기) */}
      {isAllRevealed && (
        <div className="mt-8 w-full bg-pink border-4 border-black rounded-3xl p-6 shadow-[5px_5px_0px_0px_rgba(0,0,0,1)] text-center animate-in zoom-in-95 fade-in duration-300">
          {isHost ? (
            /* 교사 칠판 뷰 전용 안내 배너 */
            <>
              <h4 className="text-xl md:text-2xl font-black text-black">
                🎉 우리 반 전체 럭키티켓 추첨 및 정산 완료! 🎉
              </h4>
              <p className="text-xl md:text-2xl font-black text-yellow-950 mt-2 tracking-tight">
                위 목록에서 학생별 실시간 보너스 점수를 확인하세요!
              </p>
              <p className="text-xs md:text-sm font-black text-slate-800 mt-2">
                잠시 후 최종 점수 스코어보드가 발표됩니다!
              </p>
            </>
          ) : (
            /* 학생 플레이어 뷰 전용 개인 보너스 배너 */
            <>
              <h4 className="text-xl md:text-2xl font-black text-black">
                ✨ 🎁 행운 규칙 보너스 점수 최종 획득! 🎁 ✨
              </h4>
              <p className="text-3xl md:text-4xl font-black text-yellow-900 mt-2 tracking-tight">
                +{matchResults.totalBonusScore} 점 획득!
              </p>
              <p className="text-xs md:text-sm font-black text-slate-800 mt-2">
                잠시 후 최종 점수 스코어보드가 발표됩니다!
              </p>
            </>
          )}
        </div>
      )}
    </div>
  );
}
