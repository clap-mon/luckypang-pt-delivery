"use client";

import React, { useState, useEffect, useMemo } from "react";
import { useParams, useSearchParams } from "next/navigation";
import { Quiz } from "../../../../lib/mathEngine";

export default function AnswerKeyPopupPage() {
  const params = useParams();
  const searchParams = useSearchParams();
  const roomCode = params.code as string;
  const mode = searchParams.get("mode") || "standard";

  const [currentQuiz, setCurrentQuiz] = useState<Quiz | null>(null);

  // 로컬스토리지에서 퀴즈 읽어오기
  const loadQuizFromLocalStorage = () => {
    if (typeof window !== "undefined") {
      const stored = localStorage.getItem("luckypang_current_quiz");
      if (stored) {
        try {
          setCurrentQuiz(JSON.parse(stored));
        } catch (e) {
          console.error("Failed to parse quiz from localStorage", e);
        }
      }
    }
  };

  useEffect(() => {
    // 마운트 시점에 초기 퀴즈 정보 로드
    loadQuizFromLocalStorage();

    // 다른 창(부모 창)의 로컬스토리지 변경 이벤트 감지
    const handleStorageChange = (e: StorageEvent) => {
      if (e.key === "luckypang_current_quiz") {
        loadQuizFromLocalStorage();
      }
    };

    window.addEventListener("storage", handleStorageChange);
    
    // 폴링 보조: 스토리지 이벤트가 드물게 유실될 가능성을 감안하여 1초 주기 동기화
    const interval = setInterval(loadQuizFromLocalStorage, 1000);

    return () => {
      window.removeEventListener("storage", handleStorageChange);
      clearInterval(interval);
    };
  }, []);

  // 보기 리스트 셔플 유지 (보기 섞기는 퀴즈 객체의 options id가 변경될 때 발생하도록 메모이징)
  const shuffledOptions = useMemo(() => {
    if (!currentQuiz) return [];
    return currentQuiz.options;
  }, [currentQuiz]);

  return (
    <div className="flex flex-col min-h-screen bg-cream px-6 py-8 font-jua select-none">
      {/* 팝업 헤더 */}
      <div className="w-full flex items-center justify-between bg-white border-4 border-black rounded-3xl p-6 mb-6 shadow-[5px_5px_0px_0px_rgba(0,0,0,1)]">
        <div className="flex items-center gap-4">
          <span className="text-4xl">🔑</span>
          <div>
            <h2 className="text-2xl font-black text-black">정답 확인창 (교사 전용)</h2>
            <p className="text-xs font-bold text-gray-500 mt-0.5">
              이 창은 학생들에게 보이지 않는 개별 모니터(노트북 등)에 배치하세요.
            </p>
          </div>
        </div>
        <div className="bg-lemon border-2 border-black rounded-xl px-4 py-2 text-lg font-black shadow-[2px_2px_0px_0px_rgba(0,0,0,1)]">
          방 번호: {roomCode}
        </div>
      </div>

      {/* 퀴즈 정답 내용 카드 */}
      <div className="flex-1 bg-white border-4 border-black rounded-3xl p-8 shadow-[5px_5px_0px_0px_rgba(0,0,0,1)] flex flex-col justify-start">
        {currentQuiz ? (
          <div className="flex flex-col h-full">
            {/* 문제 텍스트 */}
            <div className="bg-sky border-2 border-black rounded-2xl p-6 mb-8 shadow-[3px_3px_0px_0px_rgba(0,0,0,1)]">
              <span className="inline-block bg-white text-black text-sm font-black px-3.5 py-1.5 border border-black rounded-full mb-3 shadow-[1px_1px_0px_0px_rgba(0,0,0,1)]">
                현재 라운드 문제
              </span>
              <h3 className="text-2xl md:text-3xl font-bold text-black leading-relaxed break-keep">
                {currentQuiz.question_text}
              </h3>
            </div>

            {/* 보기 해설 및 분류 리스트 */}
            <div className="flex-1 flex flex-col gap-4">
              <h4 className="text-base font-black text-gray-500 mb-1">💡 각 보기 정보 및 해설 가이드</h4>
              {shuffledOptions.map((option, idx) => {
                const getBadgeStyle = () => {
                  if (option.isCorrect) {
                    return option.isLotto
                      ? "bg-lemon text-yellow-800 border-yellow-500"
                      : "bg-sky text-blue-800 border-blue-500";
                  } else {
                    return option.isBomb
                      ? "bg-bomb text-red-800 border-red-500 animate-pulse"
                      : "bg-gray-100 text-gray-600 border-gray-400";
                  }
                };

                const getLabel = () => {
                  if (option.isCorrect) {
                    return option.isLotto
                      ? (mode === "extreme" ? "🌟 럭키팡 정답! (+300 & 🎟️)" : "🌟 럭키팡 정답! (+300)")
                      : "✔️ 일반 정답 (+100)";
                  } else {
                    return option.isBomb
                      ? "💥 폭탄 오답 (-100)"
                      : "❌ 함정 오답 (0)";
                  }
                };

                const getDefaultDescription = (opt: any) => {
                  if (opt.isCorrect) {
                    return opt.isLotto
                      ? "럭키팡 정답: 개념을 가장 종합적이고 올바르게 나타낸 식입니다."
                      : "일반 정답: 이 문제의 정석적인 풀이 결과입니다.";
                  } else {
                    return opt.isBomb
                      ? "폭탄 오답: 개념이 정반대로 뒤틀린 오답입니다. (선택 시 감점)"
                      : "함정 오답: 학생들이 흔히 헷갈릴 수 있는 전형적인 개념 혼동 오답입니다.";
                  }
                };

                const desc = option.description || getDefaultDescription(option);

                return (
                  <div
                    key={option.id}
                    className="flex flex-col md:flex-row justify-between items-start md:items-center bg-cream border-2 border-black rounded-xl p-4 gap-3 shadow-[2.5px_2.5px_0px_0px_rgba(0,0,0,1)]"
                  >
                    <div className="flex items-start gap-3">
                      <span className="w-8 h-8 flex items-center justify-center rounded-full border-2 border-black bg-white text-base font-black shrink-0 mt-0.5 shadow-[1px_1px_0px_0px_rgba(0,0,0,1)]">
                        {idx + 1}
                      </span>
                      <div>
                        <div className="text-xl font-black text-black">
                          {option.text}
                        </div>
                        {desc && (
                          <div className="text-sm font-bold text-gray-500 mt-1 break-keep">
                            📝 {desc}
                          </div>
                        )}
                      </div>
                    </div>

                    <span
                      className={`text-sm font-black px-3.5 py-1.5 border-2 rounded-lg shadow-[1.5px_1.5px_0px_0px_rgba(0,0,0,1)] shrink-0 ${getBadgeStyle()}`}
                    >
                      {getLabel()}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>
        ) : (
          <div className="flex-1 flex flex-col items-center justify-center text-center text-gray-400 py-12 border-2 border-dashed border-gray-300 rounded-2xl">
            <span className="text-5xl mb-4">⌛</span>
            <p className="text-sm font-bold">진행 중인 퀴즈가 없습니다.</p>
            <p className="text-xs mt-1">대시보드에서 퀴즈 게임을 시작하면 정답표가 활성화됩니다.</p>
          </div>
        )}
      </div>
    </div>
  );
}
