import { NextRequest, NextResponse } from "next/server";
import { verifyJwt } from "../../utils/jwt";
import { pool } from "../../utils/db";

// 인증 헤더 상수
const AUTH_HEADER = "authorization";

/**
 * @api 같은 조인(지역 그룹)의 훈련 정보 조회 API
 * @description
 *  - 사용자와 같은 region_group_id를 가진 사용자들의 훈련 정보를 가져옴
 *  - JWT 인증 필요
 *  - 필수 파라미터: type(meditation/reading/prayer/soc/sevenup), date
 *
 * @example
 * GET /api/trainings/region?type=meditation&date=2023-05-01
 */
export async function GET(request: NextRequest) {
  // 경로에서 리소스 추출 (예: /api/traings?type=meditations&date=2025-05-11)
  const { searchParams } = new URL(request.url);
  const type = searchParams.get("type");
  const date = searchParams.get("date");

  // 인증 체크
  const authHeader = request.headers.get(AUTH_HEADER);
  const token = authHeader?.split(" ")[1];
  if (!token || !verifyJwt(token)) {
    return NextResponse.json({ error: "인증 필요" }, { status: 401 });
  }

  // JWT에서 userId 추출
  const payload = verifyJwt(token);
  const userId = payload?.id;

  // 매직 문자열 상수화
  const TABLES: { [key: string]: string } = {
    meditation: "training_meditations",
    reading: "training_readings",
    prayer: "training_prayers",
    soc: "training_socs",
    sevenup: "training_sevenups",
  };

  if (!type || !(type in TABLES)) {
    return NextResponse.json(
      { error: "type 파라미터 필요 또는 잘못됨" },
      { status: 400 }
    );
  }

  if (!date) {
    return NextResponse.json({ error: "date 파라미터 필요" }, { status: 400 });
  }

  let connection;
  try {
    connection = await pool.getConnection();

    // 1. 현재 사용자의 region_group_id 조회
    const userQuery = `SELECT region_group_id FROM users WHERE id = ?`;
    const [userResult] = await connection.query(userQuery, [userId]);
    const userRows = userResult as any[];

    if (userRows.length === 0) {
      connection.release();
      return NextResponse.json(
        { error: "사용자 정보를 찾을 수 없습니다" },
        { status: 404 }
      );
    }

    const regionGroupId = userRows[0].region_group_id;

    // 2. 같은 region_group_id를 가진 사용자 ID 목록 조회
    const membersQuery = `SELECT id FROM users WHERE region_group_id = ?`;
    const [membersResult] = await connection.query(membersQuery, [
      regionGroupId,
    ]);
    const members = membersResult as any[];

    if (!Array.isArray(members) || members.length === 0) {
      connection.release();
      return NextResponse.json({ success: true, data: [] }, { status: 200 });
    }

    // 3. 사용자 ID 배열 생성
    const userIds = members.map((member) => member.id);

    // 날짜 필터링 조건 추가
    const queryParams = [...userIds];

    // IN 절에 배열을 직접 전달하는 대신 물음표를 사용자 ID 수만큼 생성합니다
    const placeholders = userIds.map(() => "?").join(",");

    // 날짜가 있는 경우: DATE(date) = ? 조건 추가
    const tableQuery = `
        SELECT * FROM ${TABLES[type]} 
        WHERE user_id IN (${placeholders}) 
        AND DATE(date) = ?
      `;
    queryParams.push(date);

    const [tableRows] = await connection.query(tableQuery, queryParams);

    console.log(tableRows);

    connection.release();
    return NextResponse.json({ success: true, data: tableRows });
  } catch (error) {
    if (connection) connection.release();
    return NextResponse.json(
      { error: "DB 오류", detail: (error as any).message },
      { status: 500 }
    );
  }
}
