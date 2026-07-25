import {
  addHoliday,
  addHolidayRange,
  removeHoliday,
  removeHolidayRange,
  listHolidays,
} from "../lambda/holidays";

async function main() {
  const args = process.argv.slice(2);
  const command = args[0];

  if (!command) {
    console.error(`Usage:
  npx ts-node bin/manage-holidays.ts add <date>                 Add a single holiday (YYYY-MM-DD)
  npx ts-node bin/manage-holidays.ts range <from> <to>          Add a holiday range (inclusive)
  npx ts-node bin/manage-holidays.ts remove <date>              Remove a single holiday (YYYY-MM-DD)
  npx ts-node bin/manage-holidays.ts remove-range <from> <to>   Remove a holiday range (inclusive)
  npx ts-node bin/manage-holidays.ts list                        List all booked holidays
`);
    process.exit(1);
  }

  try {
    if (command === "add") {
      const date = args[1];
      if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
        console.error("Error: date must be in YYYY-MM-DD format");
        process.exit(1);
      }
      await addHoliday(date);
      console.log(`✓ Added holiday: ${date}`);
    } else if (command === "range") {
      const from = args[1];
      const to = args[2];
      if (!from || !to || !/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to)) {
        console.error("Error: dates must be in YYYY-MM-DD format");
        process.exit(1);
      }
      if (from > to) {
        console.error("Error: start date must be before or equal to end date");
        process.exit(1);
      }
      await addHolidayRange(from, to);
      console.log(`✓ Added holidays: ${from} to ${to}`);
    } else if (command === "remove") {
      const date = args[1];
      if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
        console.error("Error: date must be in YYYY-MM-DD format");
        process.exit(1);
      }
      await removeHoliday(date);
      console.log(`✓ Removed holiday: ${date}`);
    } else if (command === "remove-range") {
      const from = args[1];
      const to = args[2];
      if (!from || !to || !/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to)) {
        console.error("Error: dates must be in YYYY-MM-DD format");
        process.exit(1);
      }
      if (from > to) {
        console.error("Error: start date must be before or equal to end date");
        process.exit(1);
      }
      await removeHolidayRange(from, to);
      console.log(`✓ Removed holidays: ${from} to ${to}`);
    } else if (command === "list") {
      const holidays = await listHolidays();
      if (holidays.length === 0) {
        console.log("No booked holidays.");
      } else {
        console.log("Booked holidays:");
        for (const date of holidays) {
          console.log(`  ${date}`);
        }
      }
    } else {
      console.error(`Unknown command: ${command}`);
      process.exit(1);
    }
  } catch (error) {
    console.error("Error:", error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}

main();
