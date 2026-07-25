import { getBookedHolidays, addHoliday, addHolidayRange, listHolidays } from "./holidays";

// Mock DynamoDB: an in-memory table of { type, date, addedAt } items, driven by
// the Put/Query commands the implementation actually issues.
let store: Array<{ type: string; date: string; addedAt: string }> = [];

jest.mock("@aws-sdk/client-dynamodb", () => ({
  DynamoDBClient: jest.fn(),
}));

jest.mock("@aws-sdk/lib-dynamodb", () => {
  class PutCommand {
    input: any;
    constructor(input: any) {
      this.input = input;
    }
  }
  class QueryCommand {
    input: any;
    constructor(input: any) {
      this.input = input;
    }
  }
  class GetCommand {
    input: any;
    constructor(input: any) {
      this.input = input;
    }
  }

  const send = jest.fn(async (command: PutCommand | QueryCommand | GetCommand) => {
    if (command instanceof PutCommand) {
      store.push(command.input.Item);
      return {};
    }

    if (command instanceof QueryCommand) {
      const values = command.input.ExpressionAttributeValues;
      const { ":type": type, ":start": start, ":end": end } = values;
      const items = store.filter((item) => {
        if (item.type !== type) return false;
        if (start !== undefined && end !== undefined) {
          return item.date >= start && item.date <= end;
        }
        return true;
      });
      return { Items: items };
    }

    return {};
  });

  return {
    DynamoDBDocumentClient: {
      from: jest.fn(() => ({ send })),
    },
    PutCommand,
    QueryCommand,
    GetCommand,
  };
});

describe("Holiday Management", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    store = [];
  });

  it("returns empty set when no holidays are booked", async () => {
    const holidays = await getBookedHolidays("2026-08-01", "2026-08-31");
    expect(holidays.size).toBe(0);
  });

  it("adds a single holiday", async () => {
    await addHoliday("2026-08-15");
    const holidays = await listHolidays();
    expect(holidays).toContain("2026-08-15");
  });

  it("adds a holiday range", async () => {
    await addHolidayRange("2026-08-15", "2026-08-17");
    const holidays = await listHolidays();
    expect(holidays.length).toBe(3);
    expect(holidays).toContain("2026-08-15");
    expect(holidays).toContain("2026-08-16");
    expect(holidays).toContain("2026-08-17");
  });

  it("returns holidays in the given range as timestamps", async () => {
    await addHolidayRange("2026-08-10", "2026-08-12");
    const holidays = await getBookedHolidays("2026-08-01", "2026-08-31");
    expect(holidays.size).toBe(3);
  });
});
