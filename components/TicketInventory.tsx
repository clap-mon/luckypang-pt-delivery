"use client";

import React, { useEffect, useState } from "react";

interface Ticket {
  numbers: number[];
}

interface TicketInventoryProps {
  tickets: Ticket[];
}

export default function TicketInventory({ tickets }: TicketInventoryProps) {
  const [animateIndex, setAnimateIndex] = useState<number | null>(null);

  // 티켓이 추가될 때마다 마지막 티켓에 애니메이션 클래스를 일시적으로 적용
  useEffect(() => {
    if (tickets.length > 0) {
      const lastIndex = tickets.length - 1;
      setAnimateIndex(lastIndex);
      const timer = setTimeout(() => setAnimateIndex(null), 1000);
      return () => clearTimeout(timer);
    }
  }, [tickets.length]);

  return (
    <div className="w-full bg-cream neo-box p-3.5 flex flex-col max-h-[75vh]">
      {/* 타이틀 헤더 */}
      <div className="bg-sky border-2 border-black rounded-xl p-2 mb-3 flex items-center justify-between shadow-[1.5px_1.5px_0px_0px_rgba(0,0,0,1)]">
        <h4 className="text-sm md:text-base font-extrabold text-black flex items-center gap-1.5">
          🎫 럭키 티켓 보관함
        </h4>
        <span className="bg-white text-black text-xs font-black px-2 py-0.5 rounded-full border border-black shadow-[0.5px_0.5px_0px_0px_rgba(0,0,0,1)]">
          {tickets.length}장 보유
        </span>
      </div>

      {/* 티켓 리스트 스크롤 영역 */}
      <div className="flex-1 overflow-y-auto pr-1 flex flex-col gap-3.5 scrollbar-thin scrollbar-thumb-black scrollbar-track-cream min-h-[160px] max-h-[50vh]">
        {tickets.length === 0 ? (
          <div className="flex-1 min-h-[120px] flex flex-col items-center justify-center border-2 border-dashed border-gray-400 rounded-2xl p-4 text-gray-500">
            <span className="text-3xl mb-1">🎟️</span>
            <p className="text-xs font-bold text-center break-keep leading-relaxed">
              퀴즈에서 [럭키팡 정답]을 맞히면 6자리 번호가 적힌 럭키 티켓이 여기에 보관됩니다!
            </p>
          </div>
        ) : (
          tickets.map((ticket, index) => {
            const isNewTicket = animateIndex === index;

            return (
              <div
                key={index}
                className={`bg-white border-2 border-black rounded-xl p-3 shadow-[2px_2px_0px_0px_rgba(0,0,0,1)] flex flex-col gap-2 relative overflow-hidden transition-all duration-300 ${
                  isNewTicket ? "scale-101 border-yellow-500 border-3 bg-lemon -translate-y-0.5 shadow-[3px_3px_0px_0px_rgba(0,0,0,1)]" : ""
                }`}
              >
                {/* 상단 띠지 절취선 디자인 */}
                <div className="flex items-center justify-between text-[10px] font-black text-gray-500 pb-1 border-b border-dashed border-black">
                  <span>LUCKY PANG TICKET</span>
                  <span className="text-black font-black">NO.{String(index + 1).padStart(3, "0")}</span>
                </div>

                {/* 6자리 럭키팡 번호 뱃지 리스트 */}
                <div className="flex justify-between items-center gap-1 my-1">
                  {ticket.numbers.map((num, nIdx) => (
                    <span
                      key={nIdx}
                      className="w-7 h-7 sm:w-8 sm:h-8 rounded-full border-2 border-black bg-white flex items-center justify-center text-xs sm:text-sm font-black shadow-[1px_1px_0px_0px_rgba(0,0,0,1)] shrink-0 text-black"
                    >
                      {num}
                    </span>
                  ))}
                </div>

                {/* 티켓 바코드 디자인 */}
                <div className="pt-1 border-t border-dashed border-black flex items-center justify-between">
                  <div className="flex gap-[2px] h-2.5 w-2/3 items-end">
                    <div className="w-[2px] h-full bg-black"></div>
                    <div className="w-[4px] h-full bg-black"></div>
                    <div className="w-[1.5px] h-full bg-black"></div>
                    <div className="w-[3px] h-full bg-black"></div>
                    <div className="w-[2px] h-full bg-black"></div>
                    <div className="w-[4px] h-full bg-black"></div>
                    <div className="w-[1.5px] h-full bg-black"></div>
                    <div className="w-[3px] h-full bg-black"></div>
                    <div className="w-[1.5px] h-full bg-black"></div>
                    <div className="w-[2px] h-full bg-black"></div>
                  </div>
                  <span className="text-[8px] font-black tracking-wider text-black">
                    ⭐ PANG-LUCKY ⭐
                  </span>
                </div>

                {/* 신규 티켓 획득 시 이펙트 효과 */}
                {isNewTicket && (
                  <div className="absolute top-0 right-0 bg-yellow-500 text-white font-extrabold text-[8px] px-1.5 py-0.5 border-b border-l border-black rounded-bl shadow-[0.5px_0.5px_0px_0px_rgba(0,0,0,1)] animate-pulse">
                    NEW!
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
