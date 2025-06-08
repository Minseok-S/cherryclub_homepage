import { NextRequest, NextResponse } from "next/server";
import { pool } from "../../utils/db";

export async function POST(request: NextRequest) {
  try {
    const { universe_id } = await request.json();

    // 필수 파라미터 검증
    if (!universe_id) {
      return NextResponse.json(
        { error: "사용자 ID가 필요합니다" },
        { status: 400 }
      );
    }

    const connection = await pool.getConnection();

    // 같은 대학교(universe_id)를 가진 사용자들 조회
    const [sameUniversityUsers] = await connection.query(
      `SELECT id, name FROM users WHERE universe_id = ? AND enrollment_status != '졸업'`,
      [universe_id]
    );

    connection.release();

    return NextResponse.json(sameUniversityUsers as any[]);
  } catch (error) {
    console.error("사용자 및 대학교 정보 조회 오류:", error);
    return NextResponse.json(
      { error: "사용자 및 대학교 정보 조회에 실패했습니다" },
      { status: 500 }
    );
  }
}
