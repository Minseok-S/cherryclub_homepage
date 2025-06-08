import { NextRequest, NextResponse } from "next/server";
import { pool } from "../../utils/db";
import { verifyJwt } from "../../utils/jwt";

// 인증 헤더 상수
const AUTH_HEADER = "authorization";

/**
 * 특정 팀 조회 API
 * GET /api/team/[teamId]
 * @param request - NextRequest 객체
 * @returns 팀 정보 및 멤버 목록
 */
export async function GET(request: NextRequest) {
  // 인증 확인
  const authHeader = request.headers.get(AUTH_HEADER);
  const token = authHeader?.split(" ")[1];
  if (!token || !verifyJwt(token)) {
    return NextResponse.json({ error: "인증이 필요합니다." }, { status: 401 });
  }

  const url = new URL(request.url);
  const pathParts = url.pathname.split("/");
  const teamId = pathParts[pathParts.indexOf("team") + 1];

  if (!teamId) {
    return NextResponse.json(
      { error: "teamId 파라미터 필요" },
      { status: 400 }
    );
  }

  if (isNaN(parseInt(teamId))) {
    return NextResponse.json(
      { error: "유효하지 않은 팀 ID입니다." },
      { status: 400 }
    );
  }

  let connection;
  try {
    connection = await pool.getConnection();

    // 팀 정보 조회
    const [teamRows] = await connection.query(
      `SELECT t.*, 
        (SELECT COUNT(*) FROM user_team_roles WHERE team_id = t.id) AS member_count,
        (SELECT name FROM users WHERE id = (
          SELECT user_id FROM user_team_roles WHERE team_id = t.id AND role = '팀장' LIMIT 1
        )) AS leader_name,
        p.name AS parent_team_name
      FROM teams t
      LEFT JOIN teams p ON t.parent_team_id = p.id
      WHERE t.id = ?`,
      [teamId]
    );

    if ((teamRows as any[]).length === 0) {
      connection.release();
      return NextResponse.json(
        { error: "존재하지 않는 팀입니다." },
        { status: 404 }
      );
    }

    // 팀 멤버 조회
    const [memberRows] = await connection.query(
      `SELECT 
       u.id, u.name, univ.name AS university_name,
        utr.role
      FROM user_team_roles utr
      JOIN users u ON utr.user_id = u.id
      LEFT JOIN Universities univ ON u.universe_id = univ.id
      WHERE utr.team_id = ?
      ORDER BY 
        CASE utr.role 
          WHEN '팀장' THEN 1 
          WHEN '부팀장' THEN 2 
          ELSE 3 
        END,
        u.name`,
      [teamId]
    );

    // 하위 팀 조회
    const [childTeamRows] = await connection.query(
      `SELECT t.*, 
        (SELECT COUNT(*) FROM user_team_roles WHERE team_id = t.id) AS member_count,
        (SELECT name FROM users WHERE id = (
          SELECT user_id FROM user_team_roles WHERE team_id = t.id AND role = '팀장' LIMIT 1
        )) AS leader_name
      FROM teams t
      WHERE t.parent_team_id = ?
      ORDER BY t.name`,
      [teamId]
    );

    connection.release();

    console.log({
      team: (teamRows as any[])[0],
      members: memberRows,
      childTeams: childTeamRows,
    });

    return NextResponse.json({
      team: (teamRows as any[])[0],
      members: memberRows,
      childTeams: childTeamRows,
    });
  } catch (error) {
    console.error("팀 조회 오류:", error);
    if (connection) connection.release();
    return NextResponse.json(
      { error: "팀 조회에 실패했습니다." },
      { status: 500 }
    );
  }
}
