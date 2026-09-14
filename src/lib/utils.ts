import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export type WithElementRef<T, E = HTMLElement> = T & { ref?: E | null };

export type WithoutChild<T> = T extends { child?: unknown }
  ? Omit<T, "child">
  : T;

export type WithoutChildren<T> = T extends { children?: unknown }
  ? Omit<T, "children">
  : T;

export type WithoutChildrenOrChild<T> = WithoutChildren<WithoutChild<T>>;

export const isCoarsePointer = window.matchMedia("(pointer: coarse)").matches;

/**
 * 用户是否开启了「减少动效」。过渡类动效（答案滑入、展开收起）应当跳过，
 * 只保留必要的信息变化。
 */
export const prefersReducedMotion = window.matchMedia(
  "(prefers-reduced-motion: reduce)",
).matches;
