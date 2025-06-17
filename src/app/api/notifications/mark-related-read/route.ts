import { NextRequest, NextResponse } from "next/server";
import { pool } from "../../utils/db";
import { verifyJwt } from "../../utils/jwt";

// 인증 헤더 상수
const AUTH_HEADER = "authorization";

/**
 * 관련 알림 일괄 읽음 처리 API
 * POST /api/notifications/mark-related-read
 * @param request - 요청 객체 (type, related_id 포함)
 * @returns 처리된 알림 수
 *
 * @description
 * Frontend Design Guideline 적용:
 * - Single Responsibility: 관련 알림 읽음 처리만 담당
 * - Predictability: 일관된 응답 형식 제공
 * - Error Handling: 안전한 에러 처리
 */
export async function POST(request: NextRequest) {
  // 인증 확인
  const authHeader = request.headers.get(AUTH_HEADER);
  const token = authHeader?.split(" ")[1];
  if (!token || !verifyJwt(token)) {
    return NextResponse.json({ error: "인증이 필요합니다." }, { status: 401 });
  }

  const payload = verifyJwt(token);
  const userId = payload?.id;

  // 요청 본문 파싱
  const body = await request.json();
  console.log("📥 관련 알림 읽음 처리 API 요청:", body);

  const { type, related_id } = body;

  // 필수 필드 유효성 검증
  if (!type || !related_id) {
    console.error("❌ 필수 필드 누락:", { type, related_id });
    return NextResponse.json(
      { error: "type과 related_id는 필수 항목입니다." },
      { status: 400 }
    );
  }

  // 타입 유효성 검증
  const validTypes = ["notice", "testimony"];
  if (!validTypes.includes(type)) {
    console.error("❌ 유효하지 않은 타입:", type);
    return NextResponse.json(
      { error: "유효하지 않은 타입입니다. (notice, testimony만 허용)" },
      { status: 400 }
    );
  }

  let connection;
  try {
    connection = await pool.getConnection();

    // 해당 사용자의 관련 알림들을 읽음 처리
    // type이 'notice'인 경우: 공지사항 관련 모든 알림 (좋아요, 댓글 등)
    // type이 'testimony'인 경우: 간증 관련 모든 알림 (좋아요, 댓글 등)
    const [result] = await connection.query(
      `UPDATE notifications 
       SET is_read = 1 
       WHERE user_id = ? 
         AND related_id = ? 
         AND is_read = 0
         AND (
           (? = 'notice' AND type IN ('notice', 'like', 'comment', 'reply')) OR
           (? = 'testimony' AND type IN ('testimony', 'like', 'comment', 'reply'))
         )`,
      [userId, related_id, type, type]
    );

    const affectedRows = (result as any).affectedRows;

    connection.release();

    console.log(`✅ 관련 알림 읽음 처리 완료: ${affectedRows}개 알림 처리됨`, {
      userId,
      type,
      related_id,
      affectedRows,
    });

    return NextResponse.json({
      success: true,
      message: `${affectedRows}개의 관련 알림이 읽음 처리되었습니다.`,
      affected_count: affectedRows,
    });
  } catch (error) {
    console.error("관련 알림 읽음 처리 오류:", error);
    if (connection) connection.release();
    return NextResponse.json(
      { error: "관련 알림 읽음 처리에 실패했습니다." },
      { status: 500 }
    );
  }
}
