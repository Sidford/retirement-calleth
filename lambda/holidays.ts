import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, DeleteCommand, PutCommand, QueryCommand } from "@aws-sdk/lib-dynamodb";

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const TABLE_NAME = process.env.HOLIDAYS_TABLE_NAME as string;

function parseIsoDateUtc(iso: string): Date {
  return new Date(`${iso}T00:00:00Z`);
}

function dateToIso(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function addDays(date: Date, days: number): Date {
  return new Date(date.getTime() + days * 24 * 60 * 60 * 1000);
}

/** Get all booked holidays between startDate and endDate (inclusive) as millisecond timestamps */
export async function getBookedHolidays(startDate: string, endDate: string): Promise<Set<number>> {
  const res = await ddb.send(
    new QueryCommand({
      TableName: TABLE_NAME,
      KeyConditionExpression: "#type = :type AND #date BETWEEN :start AND :end",
      ExpressionAttributeNames: { "#type": "type", "#date": "date" },
      ExpressionAttributeValues: { ":type": "holiday", ":start": startDate, ":end": endDate },
    })
  );

  const holidays = new Set<number>();
  for (const item of res.Items || []) {
    holidays.add(parseIsoDateUtc(item.date).getTime());
  }
  return holidays;
}

/** Add a single booked holiday */
export async function addHoliday(date: string): Promise<void> {
  await ddb.send(
    new PutCommand({
      TableName: TABLE_NAME,
      Item: { type: "holiday", date, addedAt: new Date().toISOString() },
    })
  );
}

/** Add a range of booked holidays (inclusive) */
export async function addHolidayRange(startDate: string, endDate: string): Promise<void> {
  let current = parseIsoDateUtc(startDate);
  const end = parseIsoDateUtc(endDate);
  const now = new Date().toISOString();

  while (current.getTime() <= end.getTime()) {
    const iso = dateToIso(current);
    await ddb.send(
      new PutCommand({
        TableName: TABLE_NAME,
        Item: { type: "holiday", date: iso, addedAt: now },
      })
    );
    current = addDays(current, 1);
  }
}

/** Remove a single booked holiday */
export async function removeHoliday(date: string): Promise<void> {
  await ddb.send(
    new DeleteCommand({
      TableName: TABLE_NAME,
      Key: { type: "holiday", date },
    })
  );
}

/** Remove a range of booked holidays (inclusive) */
export async function removeHolidayRange(startDate: string, endDate: string): Promise<void> {
  let current = parseIsoDateUtc(startDate);
  const end = parseIsoDateUtc(endDate);

  while (current.getTime() <= end.getTime()) {
    const iso = dateToIso(current);
    await ddb.send(
      new DeleteCommand({
        TableName: TABLE_NAME,
        Key: { type: "holiday", date: iso },
      })
    );
    current = addDays(current, 1);
  }
}

/** List all booked holidays in chronological order */
export async function listHolidays(): Promise<string[]> {
  const res = await ddb.send(
    new QueryCommand({
      TableName: TABLE_NAME,
      KeyConditionExpression: "#type = :type",
      ExpressionAttributeNames: { "#type": "type" },
      ExpressionAttributeValues: { ":type": "holiday" },
    })
  );

  const dates = (res.Items || []).map((item) => item.date).sort();
  return dates;
}
