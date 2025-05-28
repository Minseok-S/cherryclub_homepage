import { NextRequest, NextResponse } from "next/server";
import { pool } from "../../../utils/db";
import { verifyJwt } from "../../../utils/jwt";

// 인증 헤더 상수
const AUTH_HEADER = "authorization";

/**
 * 팀 멤버 추가 API
 * POST /api/team/[teamId]/members
 * @param request - { userId, role }
 * @param context - { params: { teamId } }
 * @returns 성공 여부
 */
export async function POST(
  request: NextRequest,
  context: { params: { teamId: string } }
) {
  // 인증 확인
  const authHeader = request.headers.get(AUTH_HEADER);
  const token = authHeader?.split(" ")[1];
  if (!token || !verifyJwt(token)) {
    return NextResponse.json({ error: "인증이 필요합니다." }, { status: 401 });
  }

  const payload = verifyJwt(token);
  const teamId = parseInt(context.params.teamId);

  if (isNaN(teamId)) {
    return NextResponse.json(
      { error: "유효하지 않은 팀 ID입니다." },
      { status: 400 }
    );
  }

  let connection;
  try {
    const { userId, role } = await request.json();

    if (!userId || !role) {
      return NextResponse.json(
        { error: "사용자 ID와 역할이 필요합니다." },
        { status: 400 }
      );
    }

    // 역할 검증
    if (!["팀장", "부팀장", "팀원"].includes(role)) {
      return NextResponse.json(
        {
          error:
            "유효하지 않은 역할입니다. '팀장', '부팀장', '팀원' 중 하나여야 합니다.",
        },
        { status: 400 }
      );
    }

    connection = await pool.getConnection();

    // 팀 존재 여부 확인
    const [teamRows] = await connection.query(
      "SELECT * FROM teams WHERE id = ?",
      [teamId]
    );

    if ((teamRows as any[]).length === 0) {
      connection.release();
      return NextResponse.json(
        { error: "존재하지 않는 팀입니다." },
        { status: 404 }
      );
    }

    // 사용자 존재 여부 확인
    const [userRows] = await connection.query(
      "SELECT * FROM users WHERE id = ?",
      [userId]
    );

    if ((userRows as any[]).length === 0) {
      connection.release();
      return NextResponse.json(
        { error: "존재하지 않는 사용자입니다." },
        { status: 404 }
      );
    }

    // 팀장 수 확인 (팀장 추가 시)
    if (role === "팀장") {
      const [leaderRows] = await connection.query(
        "SELECT * FROM user_team_roles WHERE team_id = ? AND role = '팀장'",
        [teamId]
      );

      if ((leaderRows as any[]).length > 0) {
        connection.release();
        return NextResponse.json(
          { error: "이미 팀장이 존재합니다." },
          { status: 400 }
        );
      }
    }

    // 중복 멤버 확인
    const [existingRows] = await connection.query(
      "SELECT * FROM user_team_roles WHERE team_id = ? AND user_id = ?",
      [teamId, userId]
    );

    if ((existingRows as any[]).length > 0) {
      connection.release();
      return NextResponse.json(
        { error: "이미 팀에 속한 멤버입니다." },
        { status: 400 }
      );
    }

    // 멤버 추가
    await connection.query(
      "INSERT INTO user_team_roles (user_id, team_id, role) VALUES (?, ?, ?)",
      [userId, teamId, role]
    );

    connection.release();
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("팀 멤버 추가 오류:", error);
    if (connection) connection.release();
    return NextResponse.json(
      { error: "팀 멤버 추가에 실패했습니다." },
      { status: 500 }
    );
  }
}

/**
 * 팀 멤버 역할 변경 API
 * PATCH /api/team/[teamId]/members
 * @param request - { userId, role }
 * @param context - { params: { teamId } }
 * @returns 성공 여부
 */
export async function PATCH(
  request: NextRequest,
  context: { params: { teamId: string } }
) {
  // 인증 확인
  const authHeader = request.headers.get(AUTH_HEADER);
  const token = authHeader?.split(" ")[1];
  if (!token || !verifyJwt(token)) {
    return NextResponse.json({ error: "인증이 필요합니다." }, { status: 401 });
  }

  const teamId = parseInt(context.params.teamId);

  if (isNaN(teamId)) {
    return NextResponse.json(
      { error: "유효하지 않은 팀 ID입니다." },
      { status: 400 }
    );
  }

  let connection;
  try {
    const { userId, role } = await request.json();

    if (!userId || !role) {
      return NextResponse.json(
        { error: "사용자 ID와 역할이 필요합니다." },
        { status: 400 }
      );
    }

    // 역할 검증
    if (!["팀장", "부팀장", "팀원"].includes(role)) {
      return NextResponse.json(
        {
          error:
            "유효하지 않은 역할입니다. '팀장', '부팀장', '팀원' 중 하나여야 합니다.",
        },
        { status: 400 }
      );
    }

    connection = await pool.getConnection();
    await connection.beginTransaction();

    // 팀 존재 여부 확인
    const [teamRows] = await connection.query(
      "SELECT * FROM teams WHERE id = ?",
      [teamId]
    );

    if ((teamRows as any[]).length === 0) {
      await connection.rollback();
      connection.release();
      return NextResponse.json(
        { error: "존재하지 않는 팀입니다." },
        { status: 404 }
      );
    }

    // 멤버 존재 여부 확인
    const [memberRows] = await connection.query(
      "SELECT * FROM user_team_roles WHERE team_id = ? AND user_id = ?",
      [teamId, userId]
    );

    if ((memberRows as any[]).length === 0) {
      await connection.rollback();
      connection.release();
      return NextResponse.json(
        { error: "팀에 속하지 않은 멤버입니다." },
        { status: 404 }
      );
    }

    // 팀장 수 확인 (팀장 변경 시)
    if (role === "팀장") {
      // 기존 팀장 찾기
      const [leaderRows] = await connection.query(
        "SELECT * FROM user_team_roles WHERE team_id = ? AND role = '팀장' AND user_id != ?",
        [teamId, userId]
      );

      // 다른 팀장이 이미 있다면 해당 팀장 역할을 부팀장으로 변경
      if ((leaderRows as any[]).length > 0) {
        await connection.query(
          "UPDATE user_team_roles SET role = '부팀장' WHERE team_id = ? AND role = '팀장' AND user_id != ?",
          [teamId, userId]
        );
      }
    }

    // 역할 변경
    await connection.query(
      "UPDATE user_team_roles SET role = ? WHERE team_id = ? AND user_id = ?",
      [role, teamId, userId]
    );

    await connection.commit();
    connection.release();
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("팀 멤버 역할 변경 오류:", error);
    if (connection) {
      await connection.rollback();
      connection.release();
    }
    return NextResponse.json(
      { error: "팀 멤버 역할 변경에 실패했습니다." },
      { status: 500 }
    );
  }
}

/**
 * 팀 멤버 제거 API
 * DELETE /api/team/[teamId]/members
 * @param request - 요청 객체 (searchParams로 userId 전달)
 * @param context - { params: { teamId } }
 * @returns 성공 여부
 */
export async function DELETE(
  request: NextRequest,
  context: { params: { teamId: string } }
) {
  // 인증 확인
  const authHeader = request.headers.get(AUTH_HEADER);
  const token = authHeader?.split(" ")[1];
  if (!token || !verifyJwt(token)) {
    return NextResponse.json({ error: "인증이 필요합니다." }, { status: 401 });
  }

  const url = new URL(request.url);
  const pathParts = url.pathname.split("/");
  const teamId = pathParts[pathParts.length - 2];

  if (!teamId) {
    return NextResponse.json(
      { error: "teamId 파라미터 필요" },
      { status: 400 }
    );
  }

  const { searchParams } = new URL(request.url);
  const userIdParam = searchParams.get("userId");

  if (isNaN(parseInt(teamId))) {
    return NextResponse.json(
      { error: "유효하지 않은 팀 ID입니다." },
      { status: 400 }
    );
  }

  if (!userIdParam) {
    return NextResponse.json(
      { error: "사용자 ID가 필요합니다." },
      { status: 400 }
    );
  }

  const userId = parseInt(userIdParam);
  if (isNaN(userId)) {
    return NextResponse.json(
      { error: "유효하지 않은 사용자 ID입니다." },
      { status: 400 }
    );
  }

  let connection;
  try {
    connection = await pool.getConnection();

    // 팀 존재 여부 확인
    const [teamRows] = await connection.query(
      "SELECT * FROM teams WHERE id = ?",
      [teamId]
    );

    if ((teamRows as any[]).length === 0) {
      connection.release();
      return NextResponse.json(
        { error: "존재하지 않는 팀입니다." },
        { status: 404 }
      );
    }

    console.log("teamId", teamId);
    console.log("userId", userId);
    // 멤버 존재 여부 확인
    const [memberRows] = await connection.query(
      "SELECT * FROM user_team_roles WHERE team_id = ? AND user_id = ?",
      [teamId, userId]
    );

    if ((memberRows as any[]).length === 0) {
      connection.release();
      return NextResponse.json(
        { error: "팀에 속하지 않은 멤버입니다." },
        { status: 404 }
      );
    }

    // 팀장 확인 (팀장 제거 시 경고)
    const member = (memberRows as any[])[0];
    if (member.role === "팀장") {
      // 팀에 다른 멤버가 있는지 확인
      const [otherMemberRows] = await connection.query(
        "SELECT * FROM user_team_roles WHERE team_id = ? AND user_id != ?",
        [teamId, userId]
      );

      if ((otherMemberRows as any[]).length > 0) {
        connection.release();
        return NextResponse.json(
          {
            error: "팀장을 제거하기 전에 다른 멤버를 팀장으로 지정해야 합니다.",
            code: "LEADER_REMOVAL_ERROR",
          },
          { status: 400 }
        );
      }
    }

    // 멤버 제거
    await connection.query(
      "DELETE FROM user_team_roles WHERE team_id = ? AND user_id = ?",
      [teamId, userId]
    );

    connection.release();
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("팀 멤버 제거 오류:", error);
    if (connection) connection.release();
    return NextResponse.json(
      { error: "팀 멤버 제거에 실패했습니다." },
      { status: 500 }
    );
  }
}
