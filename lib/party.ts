// ============================================
// 학생 로컬스토리지 (Local-First Storage) 관리
// ============================================

export interface LuckyRecord {
  id: string;
  date: number;
  roomCode: string;
  score: number;
  bonusScore: number;
  ticketsDrawn?: any[];
  mode?: string;
}

const STORAGE_KEYS = {
  RECORDS: "luckypang_student_records",
  NICKNAME: "luckypang_nickname",
};

export const saveLuckyRecord = (record: Omit<LuckyRecord, "id" | "date">) => {
  if (typeof window === "undefined") return;
  try {
    const prevStr = localStorage.getItem(STORAGE_KEYS.RECORDS);
    const prev: LuckyRecord[] = prevStr ? JSON.parse(prevStr) : [];
    const newRecord: LuckyRecord = {
      ...record,
      id: Math.random().toString(36).substring(2, 9),
      date: Date.now(),
    };
    const updated = [newRecord, ...prev].slice(0, 50);
    localStorage.setItem(STORAGE_KEYS.RECORDS, JSON.stringify(updated));
  } catch (e) {
    console.error("Failed to save local record:", e);
  }
};

export const getLuckyRecords = (): LuckyRecord[] => {
  if (typeof window === "undefined") return [];
  try {
    const str = localStorage.getItem(STORAGE_KEYS.RECORDS);
    return str ? JSON.parse(str) : [];
  } catch (e) {
    return [];
  }
};
