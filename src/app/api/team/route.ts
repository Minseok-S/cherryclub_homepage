import { NextRequest, NextResponse } from "next/server";
import { pool } from "../utils/db";
import { verifyJwt } from "../utils/jwt";

// 인증 헤더 상수
const AUTH_HEADER = "authorization";

/**
 * 팀 목록 조회 API
 * GET /api/team
 * @param request - NextRequest 객체
 * @returns 팀 목록
 */
export async function GET(request: NextRequest) {
  // 인증 확인
  const authHeader = request.headers.get(AUTH_HEADER);
  const token = authHeader?.split(" ")[1];
  if (!token || !verifyJwt(token)) {
    return NextResponse.json({ error: "인증이 필요합니다." }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const parentTeamId = searchParams.get("parentTeamId");

  let connection;
  try {
    connection = await pool.getConnection();

    let query;
    let params: any[] = [];

    // 상위 팀 ID가 주어진 경우 해당 상위 팀의 하위 팀만 조회
    if (parentTeamId) {
      const parentId = parseInt(parentTeamId);
      if (isNaN(parentId)) {
        connection.release();
        return NextResponse.json(
          { error: "유효하지 않은 상위 팀 ID입니다." },
          { status: 400 }
        );
      }

      query = `
        SELECT t.*, 
          (SELECT COUNT(*) FROM user_team_roles WHERE team_id = t.id) AS member_count,
          (SELECT name FROM users WHERE id = (
            SELECT user_id FROM user_team_roles WHERE team_id = t.id AND role = '팀장' LIMIT 1
          )) AS leader_name
        FROM teams t
        WHERE t.parent_team_id = ?
        ORDER BY t.name
      `;
      params = [parentId];
    } else {
      // 상위 팀 ID가 없는 경우 최상위 팀만 조회
      query = `
        SELECT t.*, 
          (SELECT COUNT(*) FROM user_team_roles WHERE team_id = t.id) AS member_count,
          (SELECT name FROM users WHERE id = (
            SELECT user_id FROM user_team_roles WHERE team_id = t.id AND role = '팀장' LIMIT 1
          )) AS leader_name
        FROM teams t
        WHERE t.parent_team_id IS NULL
        ORDER BY t.name
      `;
    }

    const [rows] = await connection.query(query, params);

    console.log(rows);

    connection.release();
    return NextResponse.json({ teams: rows });
  } catch (error) {
    console.error("팀 목록 조회 오류:", error);
    if (connection) connection.release();
    return NextResponse.json(
      { error: "팀 목록 조회에 실패했습니다." },
      { status: 500 }
    );
  }
}
