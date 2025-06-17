import { NextRequest, NextResponse } from "next/server";
import { pool } from "../utils/db";
import { verifyJwt } from "../utils/jwt";

// 인증 헤더 상수
const AUTH_HEADER = "authorization";

/**
 * 지부 정보 조회 API
 * GET /api/branches
 * @param request - NextRequest 객체
 * @returns 모든 지역의 지부 정보 (지부장, 조 개수, 총 멤버 수)
 *
 * @description
 * Frontend Design Guideline 적용:
 * - Cohesion: 지부 관련 정보를 함께 관리
 * - Predictability: 일관된 응답 구조 제공
 */
export async function GET(request: NextRequest) {
  // 인증 확인
  const authHeader = request.headers.get(AUTH_HEADER);
  const token = authHeader?.split(" ")[1];
  if (!token || !verifyJwt(token)) {
    return NextResponse.json({ error: "인증이 필요합니다." }, { status: 401 });
  }

  let connection;
  try {
    connection = await pool.getConnection();

    // 지역별 정보 조회 (지부장, 조 개수, 총 멤버 수)
    const [branchesRows] = await connection.query(
      `SELECT 
        rg.region,
        COUNT(DISTINCT rg.group_number) as group_count,
        COUNT(u.id) as total_members,
        MAX(CASE WHEN u.isBranchLeader = 1 THEN u.name ELSE NULL END) as branch_leader_name,
        MAX(CASE WHEN u.isBranchLeader = 1 THEN u.id ELSE NULL END) as branch_leader_id,
        MAX(CASE WHEN u.isBranchLeader = 1 THEN univ.name ELSE NULL END) as branch_leader_school
      FROM region_groups rg
      LEFT JOIN users u ON u.region_group_id = rg.id
      LEFT JOIN Universities univ ON u.universe_id = univ.id
      GROUP BY rg.region
      HAVING total_members > 0
      ORDER BY rg.region`
    );

    connection.release();

    // Frontend Design Guideline: Predictability - 일관된 응답 구조
    const branches = (branchesRows as any[]).map((branch) => ({
      region: branch.region,
      group_count: branch.group_count,
      total_members: branch.total_members,
      branch_leader: branch.branch_leader_name
        ? {
            id: branch.branch_leader_id,
            name: branch.branch_leader_name,
            school: branch.branch_leader_school,
          }
        : null,
    }));

    return NextResponse.json({
      success: true,
      branches,
    });
  } catch (error) {
    console.error("지부 정보 조회 오류:", error);
    if (connection) connection.release();
    return NextResponse.json(
      { error: "지부 정보 조회에 실패했습니다." },
      { status: 500 }
    );
  }
}
