/**
 * Bundled 模式：题库由 vite alias `$bundled-bank` 在构建时解析为静态 JSON。
 * Library 模式下该文件不会被实例化（createSource 选择分支），alias 也指向
 * 占位 empty-bank.json，所以这里的 import 始终能解析。
 */
import questionsData from "$bundled-bank";
import type { Bank, QuizSource } from "./types";
import type { Question } from "../types";

// 由 vite.config.ts 在编译期注入
declare const __QUESTIONS_HASH__: string;

export class BundledSource implements QuizSource {
  readonly mode = "bundled" as const;
  private readonly bank: Bank;

  constructor() {
    this.bank = {
      hash: __QUESTIONS_HASH__,
      name: "题库",
      questions: questionsData as Question[],
    };
  }

  getActiveBank(): Bank {
    return this.bank;
  }

  // Bundled 模式下题库不会变化，订阅永远不会触发
  subscribe(_listener: () => void): () => void {
    return () => {};
  }
}
