import { NextRequest, NextResponse } from "next/server";
import { pool } from "../../utils/db";
import { verifyJwt } from "../../utils/jwt";

// 인증 헤더 상수
const AUTH_HEADER = "authorization";

/**
 * 현재 로그인된 사용자 정보 조회 API
 * GET /api/users/me
 * @param request - NextRequest 객체
 * @returns 현재 사용자 정보
 */
export async function GET(request: NextRequest) {
  // 인증 확인
  const authHeader = request.headers.get(AUTH_HEADER);
  const token = authHeader?.split(" ")[1];

  if (!token) {
    return NextResponse.json(
      { error: "인증 토큰이 필요합니다." },
      { status: 401 }
    );
  }

  const payload = verifyJwt(token);
  if (!payload) {
    return NextResponse.json(
      { error: "인증토큰이 만료되었습니다." },
      { status: 401 }
    );
  }

  const userId = payload.id;

  let connection;
  try {
    connection = await pool.getConnection();

    // 현재 사용자 정보 조회 (이메일 포함)
    const [userRows] = await connection.query(
      `SELECT 
        u.id, u.name, u.phone, u.email, u.birthday, u.gender,
        u.major, u.student_id, u.grade, u.semester, u.enrollment_status,
        u.authority, u.vision_camp_batch, u.ministry_status, u.is_cherry_club_member,
        u.isCampusLeader, u.created_at, u.updated_at, u.fcm_token,
        u.region_group_id,
        univ.name AS university,
        rg.region, rg.group_number
      FROM users u
      LEFT JOIN Universities univ ON u.universe_id = univ.id
      LEFT JOIN region_groups rg ON u.region_group_id = rg.id
      WHERE u.id = ?`,
      [userId]
    );

    connection.release();

    if ((userRows as any[]).length === 0) {
      return NextResponse.json(
        { error: "사용자를 찾을 수 없습니다." },
        { status: 404 }
      );
    }

    const user = (userRows as any[])[0];

    return NextResponse.json({
      success: true,
      user,
    });
  } catch (error) {
    console.error("현재 사용자 정보 조회 오류:", error);
    if (connection) connection.release();
    return NextResponse.json(
      { error: "사용자 정보 조회에 실패했습니다." },
      { status: 500 }
    );
  }
}
