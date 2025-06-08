import { NextRequest, NextResponse } from "next/server";
import { pool } from "../../utils/db";

/**
 * @description 같은 조(region_group_id) 인원 조회 API
 * @param region_group_id (number) - 조 그룹 ID
 * @returns 같은 조에 속한 사용자들의 id, name 목록
 * @example
 * GET /api/home/regionMember?region_group_id=1
 */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const region_group_id = searchParams.get("region_group_id");

    // 필수 파라미터 검증
    if (!region_group_id) {
      return NextResponse.json(
        { error: "조 그룹 ID(region_group_id)가 필요합니다" },
        { status: 400 }
      );
    }

    const connection = await pool.getConnection();

    // 같은 region_group_id를 가진 사용자들 조회
    const [sameGroupUsers] = await connection.query(
      `SELECT id, name FROM users WHERE region_group_id = ? `,
      [region_group_id]
    );

    connection.release();

    return NextResponse.json(sameGroupUsers as any[]);
  } catch (error) {
    console.error("조원(region) 정보 조회 오류:", error);
    return NextResponse.json(
      { error: "조원(region) 정보 조회에 실패했습니다" },
      { status: 500 }
    );
  }
}
