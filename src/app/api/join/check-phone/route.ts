import { NextRequest, NextResponse } from "next/server";
import type { RowDataPacket } from "mysql2/promise";
import { pool } from "../../utils/db";

/**
 * @function POST
 * @description
 *  핸드폰 번호 중복 여부를 확인하는 API입니다.
 *  이미 등록된 번호일 경우 에러를 반환합니다.
 *
 * @param req - JSON body: { phone: string }
 * @returns
 *  - 200: { exists: boolean }
 *  - 400: { error, code, message }
 *
 * @example
 * // 요청
 * fetch('/api/join/check-phone', {
 *   method: 'POST',
 *   body: JSON.stringify({ phone: "01012345678" }),
 *   headers: { "Content-Type": "application/json" }
 * })
 * // 응답: { exists: true } 또는 { exists: false }
 */

export async function POST(req: NextRequest) {
  const DUPLICATE_PHONE_ERROR_CODE = "ER_DUP_ENTRY";
  const DUPLICATE_PHONE_STATUS = 400;

  // 요청 body 파싱
  const { phone } = await req.json();

  // 전화번호 정규화 (하이픈 제거)
  const normalizePhone = (p: string) => p.replace(/[^0-9]/g, "");
  const cleanPhone = normalizePhone(phone);

  // DB 연결
  const connection = await pool.getConnection();

  // 핸드폰 번호 중복 확인 쿼리 - DB에 하이픈 포함/제외 모든 형식으로 저장될 수 있으므로 양쪽 모두 확인
  const [rows] = await connection.query<RowDataPacket[]>(
    "SELECT id FROM users WHERE REPLACE(phone, '-', '') = ? OR phone = ?",
    [cleanPhone, cleanPhone]
  );

  const isPhoneExists = rows.length > 0;

  if (isPhoneExists) {
    return NextResponse.json(
      {
        error: "이미 등록된 전화번호입니다",
        code: DUPLICATE_PHONE_ERROR_CODE,
        message: `Duplicate entry '${phone}' for key 'users.phone'`,
      },
      { status: DUPLICATE_PHONE_STATUS }
    );
  }

  return NextResponse.json({ exists: false });
}
