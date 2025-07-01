import { NextRequest, NextResponse } from "next/server";
import { pool } from "../../utils/db";
import { verifyJwt } from "../../utils/jwt";
import bcrypt from "bcrypt";

// 인증 헤더 상수
const AUTH_HEADER = "authorization";

/**
 * 사용자 정보 조회 API
 * GET /api/users/[id]
 * @param request - NextRequest 객체
 * @param context - 라우트 매개변수
 * @returns 사용자 정보
 */
export async function GET(
  request: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  // 인증 확인
  const authHeader = request.headers.get(AUTH_HEADER);
  const token = authHeader?.split(" ")[1];
  if (!token || !verifyJwt(token)) {
    return NextResponse.json({ error: "인증이 필요합니다." }, { status: 401 });
  }

  const { id } = await context.params;

  if (!id || isNaN(parseInt(id))) {
    return NextResponse.json(
      { error: "유효하지 않은 사용자 ID입니다." },
      { status: 400 }
    );
  }

  let connection;
  try {
    connection = await pool.getConnection();

    // 사용자 정보 조회
    const [userRows] = await connection.query(
      `SELECT 
        u.id, u.name, u.email, u.phone, u.birthday, u.gender,
        u.major, u.student_id, u.grade, u.semester, u.enrollment_status,
        u.vision_camp_batch, u.ministry_status, u.is_cherry_club_member,
        u.isCampusLeader, u.created_at, u.updated_at,
        univ.name AS university,
        rg.region, rg.group_number
      FROM users u
      LEFT JOIN Universities univ ON u.universe_id = univ.id
      LEFT JOIN region_groups rg ON u.region_group_id = rg.id
      WHERE u.id = ?`,
      [id]
    );

    if ((userRows as any[]).length === 0) {
      connection.release();
      return NextResponse.json(
        { error: "사용자를 찾을 수 없습니다." },
        { status: 404 }
      );
    }

    const user = (userRows as any[])[0];
    connection.release();

    return NextResponse.json({
      success: true,
      user,
    });
  } catch (error) {
    console.error("사용자 정보 조회 오류:", error);
    if (connection) connection.release();
    return NextResponse.json(
      { error: "사용자 정보 조회에 실패했습니다." },
      { status: 500 }
    );
  }
}

/**
 * 사용자 정보 수정 API
 * PATCH /api/users/[id]
 * @param request - 요청 객체 (수정할 정보 포함)
 * @param context - 라우트 매개변수
 * @returns 수정된 사용자 정보
 */
export async function PATCH(
  request: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  // 인증 확인
  const authHeader = request.headers.get(AUTH_HEADER);
  const token = authHeader?.split(" ")[1];
  if (!token || !verifyJwt(token)) {
    return NextResponse.json({ error: "인증이 필요합니다." }, { status: 401 });
  }

  const payload = verifyJwt(token);
  const currentUserId = payload?.id;
  const { id } = await context.params;

  if (!id || isNaN(parseInt(id))) {
    return NextResponse.json(
      { error: "유효하지 않은 사용자 ID입니다." },
      { status: 400 }
    );
  }

  // 본인 또는 권한자만 수정 가능
  const targetUserId = parseInt(id);
  const isOwnProfile = currentUserId === targetUserId;

  // 관리자 권한 체크 (본인이 아닌 경우)
  let hasAdminAccess = false;
  if (!isOwnProfile) {
    // 현재 사용자의 권한 조회
    let adminConnection;
    try {
      adminConnection = await pool.getConnection();
      const [authRows] = await adminConnection.query(
        `SELECT COUNT(*) as count FROM user_authorities ua
         JOIN authorities a ON ua.authority_id = a.id
         WHERE ua.user_id = ? AND a.name IN ('ADMIN', 'NCMN_STAFF', 'LEADERSHIP', 'TEAM_LEADER', 'BRANCH_DIRECTOR')`,
        [currentUserId]
      );
      hasAdminAccess = (authRows as any[])[0].count > 0;
      adminConnection.release();
    } catch (error) {
      if (adminConnection) adminConnection.release();
      console.error("권한 확인 오류:", error);
    }
  }

  const isAuthorized = isOwnProfile || hasAdminAccess;

  if (!isAuthorized) {
    return NextResponse.json(
      { error: "수정 권한이 없습니다." },
      { status: 403 }
    );
  }

  // 요청 본문 파싱
  const body = await request.json();
  const {
    name,
    phone,
    birthday,
    gender,
    major,
    grade,
    semester,
    enrollment_status,
    vision_camp_batch,
    ministry_status,
    is_cherry_club_member,
    password,
    universe_id,
    region_group_id,
  } = body;

  let connection;
  try {
    connection = await pool.getConnection();
    await connection.beginTransaction();

    // 사용자 존재 여부 확인
    const [userRows] = await connection.query(
      "SELECT id FROM users WHERE id = ?",
      [targetUserId]
    );

    if ((userRows as any[]).length === 0) {
      await connection.rollback();
      connection.release();
      return NextResponse.json(
        { error: "사용자를 찾을 수 없습니다." },
        { status: 404 }
      );
    }

    // 수정할 필드들 구성
    const updateFields = [];
    const updateValues = [];

    if (name !== undefined) {
      updateFields.push("name = ?");
      updateValues.push(name);
    }

    if (phone !== undefined) {
      // 전화번호 정규화 (하이픈 제거)
      const normalizePhone = (p: string) => p.replace(/[^0-9]/g, "");
      const cleanPhone = normalizePhone(phone);

      // 전화번호 중복 검사 - DB에 하이픈 포함/제외 모든 형식으로 저장될 수 있으므로 양쪽 모두 확인
      const [phoneCheckRows] = await connection.query(
        "SELECT id FROM users WHERE (REPLACE(phone, '-', '') = ? OR phone = ?) AND id != ?",
        [cleanPhone, cleanPhone, targetUserId]
      );

      if ((phoneCheckRows as any[]).length > 0) {
        await connection.rollback();
        connection.release();
        return NextResponse.json(
          { error: "이미 사용 중인 전화번호입니다." },
          { status: 400 }
        );
      }

      updateFields.push("phone = ?");
      updateValues.push(phone);
    }

    if (birthday !== undefined) {
      updateFields.push("birthday = ?");
      updateValues.push(birthday);
    }

    if (gender !== undefined) {
      updateFields.push("gender = ?");
      updateValues.push(gender);
    }

    if (major !== undefined) {
      updateFields.push("major = ?");
      updateValues.push(major);
    }

    if (grade !== undefined) {
      updateFields.push("grade = ?");
      updateValues.push(grade);
    }

    if (semester !== undefined) {
      updateFields.push("semester = ?");
      updateValues.push(semester);
    }

    if (enrollment_status !== undefined) {
      updateFields.push("enrollment_status = ?");
      updateValues.push(enrollment_status);
    }

    if (vision_camp_batch !== undefined) {
      updateFields.push("vision_camp_batch = ?");
      updateValues.push(vision_camp_batch);
    }

    if (ministry_status !== undefined) {
      updateFields.push("ministry_status = ?");
      updateValues.push(ministry_status);
    }

    if (is_cherry_club_member !== undefined) {
      updateFields.push("is_cherry_club_member = ?");
      updateValues.push(is_cherry_club_member);
    }

    if (universe_id !== undefined) {
      // 대학교 존재 여부 확인
      if (universe_id) {
        const [univRows] = await connection.query(
          "SELECT id FROM Universities WHERE id = ?",
          [universe_id]
        );

        if ((univRows as any[]).length === 0) {
          await connection.rollback();
          connection.release();
          return NextResponse.json(
            { error: "존재하지 않는 대학교입니다." },
            { status: 400 }
          );
        }
      }

      updateFields.push("universe_id = ?");
      updateValues.push(universe_id);
    }

    if (region_group_id !== undefined) {
      // 지역 그룹 존재 여부 확인
      if (region_group_id) {
        const [regionRows] = await connection.query(
          "SELECT id FROM region_groups WHERE id = ?",
          [region_group_id]
        );

        if ((regionRows as any[]).length === 0) {
          await connection.rollback();
          connection.release();
          return NextResponse.json(
            { error: "존재하지 않는 지역 그룹입니다." },
            { status: 400 }
          );
        }
      }

      updateFields.push("region_group_id = ?");
      updateValues.push(region_group_id);
    }

    if (password !== undefined) {
      // 비밀번호 해싱
      const hashedPassword = await bcrypt.hash(password, 10);
      updateFields.push("password = ?");
      updateValues.push(hashedPassword);
    }

    // 수정할 필드가 없는 경우
    if (updateFields.length === 0) {
      await connection.rollback();
      connection.release();
      return NextResponse.json(
        { error: "수정할 정보가 없습니다." },
        { status: 400 }
      );
    }

    // 업데이트 시간 추가
    updateFields.push("updated_at = NOW()");

    // 사용자 정보 업데이트
    updateValues.push(targetUserId);
    const updateQuery = `UPDATE users SET ${updateFields.join(
      ", "
    )} WHERE id = ?`;

    await connection.query(updateQuery, updateValues);

    // 업데이트된 사용자 정보 조회
    const [updatedRows] = await connection.query(
      `SELECT 
        u.id, u.name, u.phone, u.birthday, u.gender,
        u.major, u.student_id, u.grade, u.semester, u.enrollment_status,
        u.vision_camp_batch, u.ministry_status, u.is_cherry_club_member,
        u.isCampusLeader, u.created_at, u.updated_at,
        univ.name AS university,
        rg.region, rg.group_number
      FROM users u
      LEFT JOIN Universities univ ON u.universe_id = univ.id
      LEFT JOIN region_groups rg ON u.region_group_id = rg.id
      WHERE u.id = ?`,
      [targetUserId]
    );

    await connection.commit();
    connection.release();

    return NextResponse.json({
      success: true,
      message: "사용자 정보가 업데이트되었습니다.",
      user: (updatedRows as any[])[0],
    });
  } catch (error) {
    console.error("사용자 정보 수정 오류:", error);
    if (connection) {
      await connection.rollback();
      connection.release();
    }
    return NextResponse.json(
      { error: "사용자 정보 수정에 실패했습니다." },
      { status: 500 }
    );
  }
}
