import { NextRequest, NextResponse } from "next/server";
import { pool } from "../utils/db";
import { verifyJwt } from "../utils/jwt";
import { AuthorityService } from "../utils/authority-service";

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
 * - Single Responsibility: 새로운 권한 체제 사용으로 책임 분리
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

    // Frontend Design Guideline: Single Responsibility - 새로운 권한 체제로 지부장 조회
    // 지역별 정보 조회 (지부장, 조 개수, 총 멤버 수, 지부장 권한 정보)
    const [branchesRows] = await connection.query(
      `SELECT 
        rg.region,
        COUNT(DISTINCT rg.group_number) as group_count,
        COUNT(u.id) as total_members,
        -- 새로운 권한 체제: 지부장 권한을 가진 사용자 조회
        (SELECT u2.name 
         FROM users u2 
         INNER JOIN user_authorities ua2 ON u2.id = ua2.user_id
         INNER JOIN authorities a2 ON ua2.authority_id = a2.id
         WHERE u2.region_group_id IN (
           SELECT id FROM region_groups WHERE region = rg.region
         ) 
         AND a2.name = 'BRANCH_DIRECTOR' 
         AND ua2.is_active = TRUE
         LIMIT 1) as branch_leader_name,
        (SELECT u2.id 
         FROM users u2 
         INNER JOIN user_authorities ua2 ON u2.id = ua2.user_id
         INNER JOIN authorities a2 ON ua2.authority_id = a2.id
         WHERE u2.region_group_id IN (
           SELECT id FROM region_groups WHERE region = rg.region
         ) 
         AND a2.name = 'BRANCH_DIRECTOR' 
         AND ua2.is_active = TRUE
         LIMIT 1) as branch_leader_id,
        (SELECT univ.name 
         FROM users u2 
         INNER JOIN user_authorities ua2 ON u2.id = ua2.user_id
         INNER JOIN authorities a2 ON ua2.authority_id = a2.id
         LEFT JOIN Universities univ ON u2.universe_id = univ.id
         WHERE u2.region_group_id IN (
           SELECT id FROM region_groups WHERE region = rg.region
         ) 
         AND a2.name = 'BRANCH_DIRECTOR' 
         AND ua2.is_active = TRUE
         LIMIT 1) as branch_leader_school
      FROM region_groups rg
      LEFT JOIN users u ON u.region_group_id = rg.id
      GROUP BY rg.region
      HAVING total_members > 0
      ORDER BY rg.region`
    );

    // Frontend Design Guideline: Cohesion - 지부장의 권한 정보도 함께 조회
    const branchesWithAuthorities = [];

    for (const branch of branchesRows as any[]) {
      let branchLeaderAuthorities = null;

      // 지부장이 있는 경우 권한 정보 조회
      if (branch.branch_leader_id) {
        const userAuthorities = await AuthorityService.getUserAuthorities(
          connection,
          branch.branch_leader_id
        );

        if (userAuthorities) {
          branchLeaderAuthorities = userAuthorities.authorities.map((auth) => ({
            name: auth.name,
            display_name: auth.display_name,
            level: auth.level,
          }));
        }
      }

      branchesWithAuthorities.push({
        region: branch.region,
        group_count: branch.group_count,
        total_members: branch.total_members,
        branch_leader: branch.branch_leader_name
          ? {
              id: branch.branch_leader_id,
              name: branch.branch_leader_name,
              school: branch.branch_leader_school,
              authorities: branchLeaderAuthorities || [],
            }
          : null,
      });
    }

    connection.release();

    // Frontend Design Guideline: Predictability - 일관된 응답 구조
    return NextResponse.json({
      success: true,
      branches: branchesWithAuthorities,
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
