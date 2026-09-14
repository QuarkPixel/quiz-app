-- ─────────────────────────────────────────────────────────────────────────────
-- quiz-app 云同步表
--
-- 一行 = 浏览器 localStorage 里的一个 key：
--   quiz_app_general                  应用配置（题库列表 / 顺序 / 激活题库 / 全局设置）
--   quiz_app_questions_<hash>         某个题库的题目数组
--   quiz_app_state_<hash>             某个题库的进度 + 按库设置 + UI 偏好
--
-- 连接凭据（项目地址 + 密钥）与同步元数据**不上传**，只留在浏览器本地。
--
-- 这个文件由 Supabase 的 GitHub 集成自动应用：push 到 main 即生效。
-- 也可以直接把下面的内容粘进 Dashboard 的 SQL Editor 执行，效果一样。
-- ─────────────────────────────────────────────────────────────────────────────

create table if not exists public.quiz_app_sync (
    -- localStorage 的键名，例如 'quiz_app_general' / 'quiz_app_questions_ab12…'
    id text primary key,
    -- 原样保存的 JSON 值（题库数组、进度对象、general 配置对象）
    data jsonb not null,
    -- 服务器侧最后写入时间，用来做逐行冲突检测（客户端拿它跟自己的同步时间比）
    updated_at timestamptz not null default now()
);

comment on table public.quiz_app_sync is
    'quiz-app 的 localStorage 快照：一行对应浏览器里的一个 quiz_app_* 键。';
comment on column public.quiz_app_sync.data is
    '原样保存的 JSON 值，客户端不做任何转换。';

-- 按更新时间排序 / 筛选
create index if not exists quiz_app_sync_updated_at_idx
    on public.quiz_app_sync (updated_at desc);

-- ── updated_at 自动维护 ──────────────────────────────────────────────────────
-- 由触发器负责，客户端不需要（也不应该）自己传这个字段。
create or replace function public.quiz_app_sync_touch_updated_at()
returns trigger
language plpgsql
as $$
begin
    new.updated_at = now();
    return new;
end;
$$;

drop trigger if exists quiz_app_sync_touch on public.quiz_app_sync;
create trigger quiz_app_sync_touch
    before insert or update on public.quiz_app_sync
    for each row
    execute function public.quiz_app_sync_touch_updated_at();

-- ── 为什么这里没有 RLS 策略 ──────────────────────────────────────────────────
-- 这个应用的同步是「各带各的库」：浏览器把项目地址与密钥发给自己的 Vercel 后端，
-- 由后端转发到 Supabase。前端用的是该项目自己的 secret key。
--
-- secret key 对应 Postgres 的 service_role，它带 BYPASSRLS 属性——**任何 RLS
-- 策略对它都不起作用**。所以在这里写策略既不会生效，也会给人「数据被策略保护着」
-- 的错觉，不如不写，把真实情况写在注释里。
--
-- 由此推出两条使用上的注意事项：
--   1. 用 secret key 时，**任何拿到它的人都能完整读写这个项目**（不只是这张表）。
--      请像对待密码一样对待它：不要提交进仓库、不要贴进公开的地方。
--   2. 如果以后想让密钥可以公开（例如把这个部署分享给别人、各填各的库），
--      就该改用 publishable key + 一个只有自己知道的 sync id 列，
--      并把隔离规则写成 RLS 策略（那时这张表要多一列、下面要补四条策略）。
--
-- 表级授权仍然给上：PostgREST 访问 public schema 的表走的是 anon / authenticated
-- 角色，显式授权能让控制台里的自测也顺畅。
grant select, insert, update, delete on public.quiz_app_sync to anon, authenticated;
