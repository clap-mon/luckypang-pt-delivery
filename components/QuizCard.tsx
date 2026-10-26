"use client";

import React, { useState, useEffect, useMemo } from "react";
import { Quiz, QuizOption } from "../lib/mathEngine";

interface QuizCardProps {
  quiz: Quiz;
  onSelectOption: (option: QuizOption) => void;
  disabled: boolean;
  showFeedback?: boolean;
  isExtremeMode?: boolean;
}

export default function QuizCard({ quiz, onSelectOption, disabled, showFeedback = false, isExtremeMode = false }: QuizCardProps) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [isShaking, setIsShaking] = useState(false);

  // 퀴즈 데이터가 바뀔 때(라운드가 변경될 때) 한 번만 셔플하여 캐싱
  const currentOptions = useMemo(() => {
    setSelectedId(null);
    setIsShaking(false);
    return quiz.options;
  }, [quiz]);

  const handleOptionClick = (option: QuizOption) => {
    if (disabled) return;
    
    setSelectedId(option.id);

    // 폭탄 오답 클릭 시 진동 효과 트리거 (정답 공개 피드백 모드일 때만 작동하도록 제어 - 풀이 중에는 힌트 차단)
    if (option.isBomb && showFeedback) {
      setIsShaking(true);
      setTimeout(() => setIsShaking(false), 500);
    }

    // 부모 콜백 전달
    onSelectOption(option);
  };

  return (
    <div className={`w-full max-w-xl bg-cream neo-box p-4 md:p-5 flex flex-col items-center ${isShaking ? "animate-shake" : ""}`}>
      {/* 문제 헤더 및 질문 영역 */}
      <div className="w-full bg-lemon border-4 border-black rounded-2xl p-4 md:p-5 mb-5 shadow-[3px_3px_0px_0px_rgba(0,0,0,1)]">
        <h3 className="text-xl md:text-2xl font-black text-center text-black leading-normal break-keep">
          {quiz.question_text}
        </h3>
      </div>

      {/* 5지선다 보기 버튼 리스트 */}
      <div className="w-full flex flex-col gap-3 md:gap-3.5">
        {currentOptions.map((option, index) => {
          const isCurrentSelected = selectedId === option.id;
          const hasAnySelected = selectedId !== null;

          // 보기가 눌린 후의 상태별 스타일링 구성
          let buttonStyle = "bg-white text-black hover:translate-x-[1.5px] hover:translate-y-[1.5px] hover:shadow-[1.5px_1.5px_0px_0px_rgba(0,0,0,1)]";
          
          if (hasAnySelected) {
            if (isCurrentSelected) {
              if (showFeedback) {
                if (option.isCorrect) {
                  if (option.isLotto) {
                    // 럭키팡 대박 정답 (골드 테두리 및 옐로우)
                    buttonStyle = "bg-lemon border-4 border-yellow-500 scale-102 shadow-[0px_0px_6px_2px_rgba(234,179,8,0.4)] animate-bounce font-extrabold text-yellow-800";
                  } else {
                    // 일반 정답 (파스텔 블루)
                    buttonStyle = "bg-sky text-black border-black font-bold";
                  }
                } else {
                  if (option.isBomb) {
                    // 폭탄공 오답 (파스텔 레드)
                    buttonStyle = "bg-bomb text-red-700 font-bold border-red-600 border-4";
                  } else {
                    // 일반 오답 (베이비 핑크 및 사선)
                    buttonStyle = "bg-pink text-gray-500 line-through";
                  }
                }
              } else {
                // 피드백 공개 전에는 단순히 선택된 사실만 강조 (하늘색 테두리 & 스케일 강조)
                buttonStyle = "bg-sky border-4 border-black text-black font-extrabold scale-102";
              }
            } else {
              // 선택되지 않은 다른 보기들은 정답 공개 상태(showFeedback)일 때만 반투명/비활성화 처리
              if (showFeedback) {
                buttonStyle = "bg-gray-100 text-gray-400 opacity-60 pointer-events-none";
              }
            }
          }

          return (
            <button
              key={option.id}
              onClick={() => handleOptionClick(option)}
              disabled={disabled}
              className={`w-full py-3 md:py-3.5 px-5 md:px-6 text-base md:text-lg font-black text-left flex items-center gap-3.5 neo-btn transition-all duration-150 border-2 md:border-4 border-black shadow-[2px_2px_0px_0px_rgba(0,0,0,1)] ${buttonStyle}`}
            >
              {/* 보기 번호 및 디자인 뱃지 */}
              <span className={`w-7 h-7 flex items-center justify-center rounded-full border-2 border-black text-xs font-black bg-white text-black shrink-0 shadow-[1px_1px_0px_0px_rgba(0,0,0,1)]`}>
                {index + 1}
              </span>
              
              <span className="flex-1 break-keep leading-tight text-sm md:text-base">
                {option.text}
              </span>

              {/* 보상 정보 시각 피드백 배지 (클릭 시점에만 등장하며, 피드백 공개가 켜진 경우에만 노출) */}
              {isCurrentSelected && showFeedback && (
                <span className="text-xs px-2.5 py-0.5 border-2 border-black rounded-lg bg-white shadow-[1px_1px_0px_0px_rgba(0,0,0,1)] font-extrabold shrink-0">
                  {option.isCorrect 
                    ? (option.isLotto ? (isExtremeMode ? "🌟 럭키 팡! (+300 & 🎟️)" : "🌟 럭키 팡! (+300)") : "✔️ 정답 (+100)") 
                    : (option.isBomb ? "💥 폭탄 감점! (-100)" : "❌ 오답 (0)")
                  }
                </span>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}
