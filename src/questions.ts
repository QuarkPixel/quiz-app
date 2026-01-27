// 从 JSON 文件导入题库数据
import type { Question } from './types';
import questionsData from '../assets/questions.json';

export const questions: Question[] = questionsData as Question[];
