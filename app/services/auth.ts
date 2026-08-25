import type { Db } from "~/db/client";
import { eq } from "drizzle-orm";
import { account, transactions, user } from "~/db/schema";
import { INITIAL_CASH_CENTS } from "~/domain/config";

/**
 * 认证服务。
 *
 * 为什么用 PBKDF2 而不是 bcrypt/argon2？
 * Cloudflare Workers 是 V8 isolate，跑不了原生模块，bcrypt/argon2 直接不可用。
 * PBKDF2 是 Web Crypto 标准算法，Workers 原生支持。
 * 用 SHA-256 + 10 万次迭代 + 16 字节随机盐，对模拟盘场景足够。
 */

/** PBKDF2 迭代次数。越高越安全但越慢，10 万次在 Workers 上约几十毫秒 */
const PBKDF2_ITERATIONS = 100_000;
/** 盐长度（字节） */
const SALT_BYTES = 16;
/** 派生密钥长度（比特） */
const KEY_BITS = 256;

/** 字节数组 → hex 字符串 */
function toHex(buf: ArrayBuffer): string {
  return [...new Uint8Array(buf)]
    .map(b => b.toString(16).padStart(2, "0"))
    .join("");
}

/** hex 字符串 → 字节数组 */
function fromHex(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return bytes;
}

/**
 * 派生密码哈希。
 * @param password 明文密码
 * @param saltHex 可选；不传则随机生成新盐（注册用），传入则复现哈希（校验用）
 */
export async function hashPassword(
  password: string,
  saltHex?: string,
): Promise<{ hash: string; salt: string }> {
  const salt = saltHex
    ? fromHex(saltHex)
    : crypto.getRandomValues(new Uint8Array(SALT_BYTES));

  const keyMaterial = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(password),
    "PBKDF2",
    false,
    ["deriveBits"],
  );

  const bits = await crypto.subtle.deriveBits(
    {
      name: "PBKDF2",
      salt: salt as BufferSource,
      iterations: PBKDF2_ITERATIONS,
      hash: "SHA-256",
    },
    keyMaterial,
    KEY_BITS,
  );

  return {
    hash: toHex(bits),
    salt: saltHex ?? toHex(salt.buffer as ArrayBuffer),
  };
}

/**
 * 校验密码。用同样的盐重新派生再比对。
 * 用等长比较避免时序侧信道（虽然模拟盘风险极低，但便宜就做了）。
 */
export async function verifyPassword(
  password: string,
  hash: string,
  salt: string,
): Promise<boolean> {
  const { hash: computed } = await hashPassword(password, salt);
  if (computed.length !== hash.length)
    return false;
  let diff = 0;
  for (let i = 0; i < computed.length; i++) {
    diff |= computed.charCodeAt(i) ^ hash.charCodeAt(i);
  }
  return diff === 0;
}

/**
 * 用户名规则：3-20 位，字母数字下划线中文。
 * 中文范围用 Unicode 转义写明，比字面量 `一-龥` 更清晰：
 * U+4E00–U+9FA5 是 CJK 统一汉字基本区。
 */
const USERNAME_RE = /^[\w\u4E00-\u9FA5]{3,20}$/;

/**
 * 注册新用户。
 *
 * 副作用（同一个 D1 batch 内原子完成）：
 *  1. 建 user 记录（角色由 ADMIN_USERNAME 决定）
 *  2. 建 account，发 10 万初始本金
 *  3. 记一条 type='init' 的资金流水，便于对账
 *
 * 注意：D1 不支持交互式事务，所以用 batch 保证原子性。
 * user 表要先插才能拿到自增 id，故分两步——第二步用 batch 保证账户与流水同生共死。
 */
export async function registerUser(
  db: Db,
  env: Env,
  username: string,
  password: string,
): Promise<{ id: number; username: string; role: "admin" | "user" }> {
  const name = username.trim();

  if (!USERNAME_RE.test(name)) {
    throw new Error("用户名需为 3-20 位字母、数字、下划线或中文");
  }
  if (password.length < 6) {
    throw new Error("密码至少 6 位");
  }

  // 先查重，给出友好错误（唯一约束是最后防线）
  const exists = await db.query.user.findFirst({
    where: eq(user.username, name),
  });
  if (exists) {
    throw new Error(`用户名「${name}」已被注册`);
  }

  const { hash, salt } = await hashPassword(password);
  // 用户名与环境变量指定的管理员一致 → 授予 admin，其组合将公开展示
  const role: "admin" | "user" = name === env.ADMIN_USERNAME ? "admin" : "user";
  const now = Date.now();

  const [created] = await db
    .insert(user)
    .values({
      username: name,
      passwordHash: hash,
      salt,
      role,
      createdAt: now,
    })
    .returning();

  // 账户与初始本金流水必须同时成功
  await db.batch([
    db.insert(account).values({
      userId: created.id,
      cash: INITIAL_CASH_CENTS,
      initialCash: INITIAL_CASH_CENTS,
      totalCheckin: 0,
      createdAt: now,
    }),
    db.insert(transactions).values({
      userId: created.id,
      type: "init",
      amount: INITIAL_CASH_CENTS,
      balance: INITIAL_CASH_CENTS,
      note: "注册赠送初始本金",
      createdAt: now,
    }),
  ]);

  return { id: created.id, username: created.username, role };
}

/**
 * 登录校验。成功返回用户信息，失败返回 null。
 * 刻意不区分「用户不存在」和「密码错误」，避免用户名枚举。
 */
export async function loginUser(
  db: Db,
  username: string,
  password: string,
): Promise<{ id: number; username: string; role: "admin" | "user" } | null> {
  const u = await db.query.user.findFirst({
    where: eq(user.username, username.trim()),
  });
  if (!u)
    return null;

  const ok = await verifyPassword(password, u.passwordHash, u.salt);
  if (!ok)
    return null;

  return { id: u.id, username: u.username, role: u.role };
}

/**
 * 修改密码。需校验旧密码，成功后重新派生哈希与盐。
 */
export async function changePassword(
  db: Db,
  userId: number,
  oldPassword: string,
  newPassword: string,
): Promise<void> {
  if (newPassword.length < 6) {
    throw new Error("新密码至少 6 位");
  }

  const u = await db.query.user.findFirst({ where: eq(user.id, userId) });
  if (!u)
    throw new Error("用户不存在");

  const ok = await verifyPassword(oldPassword, u.passwordHash, u.salt);
  if (!ok)
    throw new Error("旧密码不正确");

  const { hash, salt } = await hashPassword(newPassword);
  await db
    .update(user)
    .set({ passwordHash: hash, salt })
    .where(eq(user.id, userId));
}
