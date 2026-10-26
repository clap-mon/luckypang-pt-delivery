"use client";

import React, { useState } from "react";

interface Ticket {
  numbers: number[];
}

interface ResultExportProps {
  nickname: string;
  studentNumber?: string;
  score: number;
  bonusScore: number;
  tickets: Ticket[];
  isExtremeMode: boolean;
  onClose: () => void;
  correctCount: number;
  wrongCount: number;
}

export default function ResultExport({
  nickname,
  studentNumber,
  score,
  bonusScore,
  tickets,
  isExtremeMode,
  onClose,
  correctCount,
  wrongCount,
}: ResultExportProps) {
  const [copied, setCopied] = useState(false);

  const totalScore = score + bonusScore;

  // 닉네임 앞 $ 제거 정제
  const cleanNickname = nickname.replace(/^\$/, "");
  // 학번이 2자리 이하인 경우에만 실제 학번으로 노출
  const showNumber = studentNumber && studentNumber.length <= 2;
  const studentText = showNumber ? `${studentNumber}번 ` : "";
  const modeText = isExtremeMode ? "익스트림 모드" : "기본 모드";

  // 기본 모드일 때는 티켓 수 및 럭키팡 번호 목록 숨김
  const ticketLines = isExtremeMode
    ? `\n■ 획득한 티켓 수: ${tickets.length}장\n■ 보유 럭키팡 번호 목록:\n${tickets.map((t, idx) => `  ${idx + 1}. [${t.numbers.join(", ")}]`).join("\n")}`
    : "";

  // 복사할 텍스트 템플릿 생성 (약수배수편 명칭 및 정오답 개수 포함)
  const formattedText = `[럭키팡 약수배수편 게임결과]
-------------------------------
■ 학생 정보: ${studentText}${cleanNickname}
■ 플레이 모드: ${modeText}
■ 최종 결과: 정답 ${correctCount}개 / 오답 ${wrongCount}개
■ 최종 획득 점수: ${totalScore}점${isExtremeMode ? ` (기본: ${score}점, 보너스: ${bonusScore}점)` : ""}${ticketLines}
-------------------------------
수학 퀴즈게임 럭키팡 클리어! 🍀`;

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(formattedText);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.error("클립보드 복사 실패", err);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center p-4 z-50">
      <div className="w-full max-w-lg bg-cream border-4 border-black rounded-3xl p-6 md:p-8 shadow-[8px_8px_0px_0px_rgba(0,0,0,1)] relative flex flex-col items-center">
        {/* 상단 장식용 미니 카드 */}
        <div className="absolute -top-6 bg-pink border-2 border-black rounded-full px-6 py-2 shadow-[2px_2px_0px_0px_rgba(0,0,0,1)] font-extrabold text-black text-sm">
          🏆 게임 종료 🏆
        </div>

        {/* 결과 내용 */}
        <div className="w-full text-center mt-4 mb-6">
          <h3 className="text-xl md:text-2xl font-black text-black">
            [럭키팡 약수배수편 게임결과]
          </h3>
          <p className="text-sm font-bold text-gray-500 mt-1">
            {studentText}{cleanNickname} 학생, 수고하셨습니다!
          </p>
        </div>

        {/* 대형 점수판 */}
        <div className="w-full bg-white border-2 border-black rounded-2xl p-5 mb-6 shadow-[4px_4px_0px_0px_rgba(0,0,0,1)] flex flex-col items-center justify-center">
          <span className="text-gray-400 text-xs font-bold tracking-wider">TOTAL SCORE</span>
          <span className="text-5xl font-black text-black mt-1">
            {totalScore} <span className="text-xl font-bold">점</span>
          </span>
          {isExtremeMode && bonusScore > 0 && (
            <div className="mt-2 text-xs font-bold text-yellow-600 bg-yellow-50 px-3 py-1 border border-yellow-400 rounded-full">
              (기본 퀴즈: {score}점 + 럭키팡 보너스: {bonusScore}점)
            </div>
          )}

          {/* 정답 및 오답 개수 시각적 안내 조립 */}
          <div className="mt-3.5 text-sm font-black text-slate-700 bg-slate-100 border-2 border-black rounded-xl px-4 py-1.5 shadow-[1.5px_1.5px_0px_rgba(0,0,0,1)]">
            정답: {correctCount}개 / 오답: {wrongCount}개
          </div>
        </div>

        {/* 컨트롤 버튼 리스트 */}
        <div className="w-full flex flex-col sm:flex-row gap-3">
          <button
            onClick={handleCopy}
            className={`flex-1 py-4 neo-btn text-base font-black flex items-center justify-center gap-2 ${copied ? "bg-sky text-black" : "bg-lemon text-black"
              }`}
          >
            {copied ? "✔️ 클립보드 복사 완료!" : "📋 결과 복사하기"}
          </button>

          <button
            onClick={onClose}
            className="px-6 py-4 bg-white text-black neo-btn text-base font-black"
          >
            닫기
          </button>
        </div>

        {copied && (
          <div className="absolute bottom-20 bg-black text-white text-xs font-bold px-4 py-2 rounded-full shadow-[2px_2px_0px_0px_rgba(0,0,0,1)] border-2 border-white animate-pulse">
            📋 복사 완료! 학급 게시판(패들렛)에 붙여넣으세요!
          </div>
        )}
      </div>
    </div>
  );
}
