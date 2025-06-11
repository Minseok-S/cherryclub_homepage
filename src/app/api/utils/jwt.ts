import jwt from "jsonwebtoken";
import crypto from "crypto";

/**
 * JWT 비밀키 (환경변수에서 관리, 미설정 시 에러 발생)
 */
const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET) {
  throw new Error("JWT_SECRET 환경변수가 설정되어 있지 않습니다.");
}
const JWT_SECRET_KEY = JWT_SECRET as string;

/**
 * JWT 토큰 만료 시간 (초)
 */
const JWT_EXPIRES_IN = 60 * 60 * 24; // 24시간으로 연장

/**
 * JWT 토큰을 발급합니다.
 * @param {object} payload - 토큰에 담을 데이터(예: { id, role })
 * @returns {string} JWT 토큰
 * @example
 *   const token = signJwt({ id: 1, role: 'admin' });
 */
export function signJwt(payload: object): string {
  console.log(
    `새 JWT 토큰 발급: ${JSON.stringify(payload)}, 만료: ${JWT_EXPIRES_IN}초`
  );
  return jwt.sign(payload, JWT_SECRET_KEY, { expiresIn: JWT_EXPIRES_IN });
}

/**
 * JWT 토큰을 검증하고 payload를 반환합니다.
 * @param {string} token - JWT 토큰
 * @returns {object|null} payload (유효하지 않으면 null)
 * @example
 *   const payload = verifyJwt(token);
 *   if (payload && payload.role === 'admin') { ... }
 */
export function verifyJwt(token: string): any | null {
  try {
    const decoded = jwt.verify(token, JWT_SECRET_KEY);
    console.log(`JWT 토큰 검증 성공: ${JSON.stringify(decoded)}`);
    return decoded;
  } catch (err) {
    console.error("JWT 토큰 검증 실패:", err);
    return null;
  }
}

/**
 * 리프레시 토큰을 생성합니다.
 * @returns {string} 랜덤 리프레시 토큰
 * @example
 *   const refreshToken = generateRefreshToken();
 */
export function generateRefreshToken(): string {
  const token = crypto.randomBytes(32).toString("hex");
  console.log(`새 리프레시 토큰 생성: ${token}`);
  return token;
}
