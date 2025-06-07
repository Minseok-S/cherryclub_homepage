import { NextResponse } from "next/server";
import { pool } from "../../utils/db";

/**
 * 모든 조(region groups) 정보를 가져오는 API
 * @returns 모든 조 정보 목록
 */
export async function GET() {
  try {
    const connection = await pool.getConnection();

    // 모든 region_groups 데이터 가져오기
    const [groups] = await connection.query(
      `SELECT id, CONCAT(region, ' ', group_number) as name, 
       CONCAT(region, ' 지역 ', group_number) as description 
       FROM region_groups 
       ORDER BY region, group_number`
    );

    connection.release();

    console.log(groups);

    return NextResponse.json(groups);
  } catch (error) {
    console.error("조 데이터 조회 오류:", error);
    return NextResponse.json({ error: "조 목록 조회 실패" }, { status: 500 });
  }
}
