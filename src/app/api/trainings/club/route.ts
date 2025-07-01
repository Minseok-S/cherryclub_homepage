import { NextRequest, NextResponse } from "next/server";
import { verifyJwt } from "../../utils/jwt";
import { pool } from "../../utils/db";

// 인증 헤더 상수
const AUTH_HEADER = "authorization";

export async function GET(request: NextRequest) {
  // 경로에서 리소스 추출 (예: /api/traings?type=meditations&universe_id=123&date=2025-05-11)
  const { searchParams } = new URL(request.url);
  const type = searchParams.get("type");
  const universeId = searchParams.get("universe_id");
  const date = searchParams.get("date");

  // 인증 체크
  const authHeader = request.headers.get(AUTH_HEADER);
  const token = authHeader?.split(" ")[1];
  if (!token || !verifyJwt(token)) {
    return NextResponse.json({ error: "인증 필요" }, { status: 401 });
  }

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

  if (!universeId) {
    return NextResponse.json(
      { error: "universe_id 파라미터 필요" },
      { status: 400 }
    );
  }

  if (!date) {
    return NextResponse.json({ error: "date 파라미터 필요" }, { status: 400 });
  }

  let connection;
  try {
    connection = await pool.getConnection();

    // universe_id에 해당하는 사용자 ID 목록 조회
    const userQuery = `SELECT id FROM users WHERE universe_id = ? AND enrollment_status != '졸업'`;
    const [userRows] = await connection.query(userQuery, [universeId]);

    if (!Array.isArray(userRows) || userRows.length === 0) {
      connection.release();
      return NextResponse.json({ success: true, data: [] }, { status: 200 });
    }

    // 사용자 ID 배열 생성
    const userIds = (userRows as any[]).map((row) => row.id);

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
