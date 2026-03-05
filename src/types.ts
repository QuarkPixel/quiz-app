/**
 * 类型定义
 */

/** 选项 */
export interface Option {
  text: string;
}

/** 题目类型 */
export type QuestionType = 'judgment' | 'single' | 'multiple' | 'blank';

/** 题目 */
export interface Question {
  id: string;
  type: QuestionType;
  question: string;
  options?: Option[];
  answer: boolean | number[] | string;
}

/** 活动池中的题目 */
export interface ActivePoolItem {
  id: string;
  /** 连续答对次数 */
  consecutiveCorrect: number;
  /** 是否曾经答错过 */
  hasEverMistaken: boolean;
  /** 上次被选中的轮次 */
  lastSelectedRound: number;
}

/** 用户设置 */
export interface UserSettings {
  /** 答题正确时自动下一题 */
  autoNextOnCorrect: boolean;
  /** 活动题目池大小 */
  activePoolSize: number;
  /** 首次掌握所需连续正确次数 */
  correctStreakToMaster: number;
  /** 答错后掌握所需连续正确次数 */
  correctStreakAfterMistake: number;
}

/** 持久化存储的状态 */
export interface StoredState {
  /** 已掌握的题目 ID */
  masteredIds: string[];
  /** 活动题目池 */
  activePool: ActivePoolItem[];
  /** 当前轮次 */
  currentRound: number;
  /** 题型筛选 */
  filterType: QuestionType | 'all';
  /** 用户设置 */
  settings: UserSettings;
}

/** 运行时状态（包含计算出的待学习题目） */
export interface RuntimeState extends StoredState {
  /** 待学习的题目（运行时计算，不存储） */
  pendingIds: string[];
}

/** 统计信息 */
export interface Stats {
  /** 已掌握题目数 */
  mastered: number;
  /** 学习中题目数（活动池中） */
  learning: number;
  /** 待学习题目数 */
  pending: number;
  /** 总题目数 */
  total: number;
}
