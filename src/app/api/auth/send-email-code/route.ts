import { NextRequest, NextResponse } from "next/server";
import nodemailer from "nodemailer";
import { pool } from "../../utils/db";

/**
 * 인증번호 자리수 상수
 */
const VERIFICATION_CODE_LENGTH = 6;

/**
 * 주어진 길이의 숫자 인증번호를 생성합니다.
 * @param {number} length 인증번호 자리수
 * @returns {string} 인증번호
 * @example
 *   const code = generateVerificationCode(6); // '483920'
 */
function generateVerificationCode(length: number): string {
  return Array.from({ length }, () => Math.floor(Math.random() * 10)).join("");
}

/**
 * 이메일로 인증번호를 전송합니다.
 * @param {string} email 수신자 이메일
 * @param {string} code 인증번호
 * @returns {Promise<void>}
 * @throws {Error} 전송 실패 시 에러 발생
 * @example
 *   await sendVerificationEmail('test@example.com', '123456');
 */
async function sendVerificationEmail(
  email: string,
  code: string
): Promise<void> {
  const transporter = nodemailer.createTransport({
    host: "smtp.naver.com",
    port: 465, // SSL 포트
    secure: true, // SSL 사용
    auth: {
      user: process.env.EMAIL_USER,
      pass: process.env.EMAIL_PASS,
    },
  });

  await transporter.sendMail({
    from: '"NCMN 대학캠퍼스" <bbb9316@naver.com>',
    to: email,
    subject: "[NCMN 대학캠퍼스] 본인인증 인증번호",
    text: `본인인증 인증번호: ${code}`,
  });
}

/**
 * 이메일 인증번호 전송 API
 * POST /api/auth/send-email-code
 * @param {NextRequest} req
 * @returns {Promise<NextResponse>}
 * @example
 *   fetch('/api/auth/send-email-code', { method: 'POST', body: JSON.stringify({ email: 'test@example.com' }) })
 */
export async function POST(req: NextRequest) {
  console.log("📧 [API 호출] 인증번호 발송 API 시작됨");
  let connection;
  try {
    const { email } = await req.json();
    console.log(`📧 [요청 데이터] 이메일: ${email}`);

    if (!email || typeof email !== "string") {
      console.log("📧 [에러] 이메일 누락 또는 타입 오류");
      return NextResponse.json(
        { error: "이메일이 필요합니다." },
        { status: 400 }
      );
    }
    const code = generateVerificationCode(VERIFICATION_CODE_LENGTH);
    console.log(`📧 인증번호 생성: ${email} -> ${code}`);

    console.log("📧 [이메일 발송] 시작...");
    await sendVerificationEmail(email, code);
    console.log("📧 [이메일 발송] 완료");

    connection = await pool.getConnection();
    console.log("📧 [DB 연결] 성공");

    // 기존 인증번호 삭제
    await connection.query(
      "DELETE FROM email_verification_codes WHERE email = ?",
      [email]
    );
    console.log(`📧 기존 인증번호 삭제 완료: ${email}`);

    // 새 인증번호 저장 (5분 유효)
    const expiresAt = new Date(Date.now() + 5 * 60 * 1000);
    await connection.query(
      "INSERT INTO email_verification_codes (email, code, expires_at) VALUES (?, ?, ?)",
      [email, code, expiresAt]
    );
    console.log(
      `📧 새 인증번호 저장 완료: ${email} -> ${code}, 만료시간: ${expiresAt}`
    );

    connection.release();
    console.log("📧 [API 완료] 인증번호 발송 성공");
    return NextResponse.json({ ok: true, code });
  } catch (error: any) {
    console.log("📧 [API 에러] 인증번호 발송 실패:", error.message);
    if (connection) connection.release();
    return NextResponse.json(
      { error: error.message || "인증번호 전송 실패" },
      { status: 500 }
    );
  }
}
