import test from "node:test";
import assert from "node:assert/strict";

import worker, { normalize } from "../src/index.js";

test("signed Amount column excludes incoming ACH paycheck rows", () => {
	const rows = normalize([
		["Date", "Description", "Amount", "Balance"],
		[
			"07/27/2026",
			"Fidelity Technol DES:499419 ID:1818270 INDN:Employee PPD",
			"2710.67",
			"10535.45",
		],
		["07/24/2026", "WINCO FOODS #1", "-75.00", "6395.24"],
	]);

	assert.equal(rows[0], null);
	assert.equal(rows[1].amount, 75);
	assert.equal(rows[1].description, "WINCO FOODS #1");
});

test("separate debit and credit columns keep debits and exclude credits", () => {
	const rows = normalize([
		["Date", "Description", "Debit Amount", "Credit Amount"],
		["07/27/2026", "PAYCHECK", "", "2710.67"],
		["07/24/2026", "WINCO FOODS #1", "75.00", ""],
	]);

	assert.equal(rows[0], null);
	assert.equal(rows[1].amount, 75);
});

test("positive-only Amount files retain supported expense exports", () => {
	const rows = normalize([
		["Date", "Description", "Amount"],
		["07/24/2026", "WINCO FOODS #1", "75.00"],
		["07/27/2026", "PAYCHECK", "2710.67"],
	]);

	assert.equal(rows[0].amount, 75);
	assert.equal(rows[1], null);
});

test("BOFA summary rows before the table do not prevent expense parsing", () => {
	const rows = normalize([
		["Description", "", "Summary Amt."],
		["Beginning balance as of 01/01/2026", "", "8044.41"],
		["Total credits", "", "62528.19"],
		["Total debits", "", "-57064.25"],
		["Ending balance as of 10/30/2026", "", "13508.35"],
		["Date", "Description", "Amount", "Running Bal."],
		["46024", "WINCO FOODS #1 01/01 PURCHASE Fort Worth TX", "-17.12", "9183.16"],
		["46025", "Fidelity Technol ID:18418270 PPD", "2710.67", "11893.83"],
	]);

	assert.equal(rows.length, 2);
	assert.equal(rows[0].amount, 17.12);
	assert.equal(rows[0].description, "WINCO FOODS #1 01/01 PURCHASE Fort Worth TX");
	assert.equal(rows[1], null);
});

test("prefers exact Description header over the Chase Details debit/credit field", () => {
	const rows = normalize([
		["Details", "Posting Date", "Description", "Amount", "Type", "Balance", "Check or Slip #"],
		["DEBIT", "10/27/2026", "WINCO FOODS #137 FORT WORTH TX", "-24.91", "DEBIT_CARD", "4670.81", ""],
	]);

	assert.equal(rows[0].amount, 24.91);
	assert.equal(rows[0].description, "WINCO FOODS #137 FORT WORTH TX");
});

test("preview does not mark repeated upload rows as already in the ledger", async () => {
	const originalFetch = globalThis.fetch;
	try {
		globalThis.fetch = async (url, init = {}) => {
			if (String(url).includes("?fields=sheets.properties")) {
				return new Response(JSON.stringify({
					sheets: [{ properties: { title: "Sheet1" } }],
				}), { status: 200, headers: { "Content-Type": "application/json" } });
			}
			return new Response(JSON.stringify({
				values: [["Timestamp", "Amount", "Category", "Description", "Expense Type", "Transaction ID", "Category ID"]],
			}), { status: 200, headers: { "Content-Type": "application/json" } });
		};
		const response = await worker.fetch(new Request("https://worker.test", {
			method: "POST",
			headers: {
				Authorization: "Bearer test-token",
				"X-Spreadsheet-ID": "test-sheet",
				"X-Action": "preview",
			},
			body: [
				"Date,Description,Amount",
				"2026-07-02,Local Market,-39.95",
				"2026-07-02,Local Market,-39.95",
			].join("\n"),
		}));
		const payload = await response.json();

		assert.equal(payload.duplicates, 0);
		assert.deepEqual(payload.rows.map((row) => row.duplicate), [false, false]);
	} finally {
		globalThis.fetch = originalFetch;
	}
});

test("preview migrates a legacy Type header back to Category", async () => {
	const originalFetch = globalThis.fetch;
	const requests = [];
	globalThis.fetch = async (url, init = {}) => {
		requests.push({ url: String(url), method: init.method || "GET", body: init.body });
		if (String(url).includes("?fields=sheets.properties")) {
			return new Response(JSON.stringify({
				sheets: [{ properties: { title: "Sheet1" } }],
			}), { status: 200, headers: { "Content-Type": "application/json" } });
		}
		return new Response(JSON.stringify(
			init.method === "PUT" ? { updatedCells: 1 } : {
				values: [["Timestamp", "Amount", "Type", "Description", "Expense Type", "Transaction ID", "Category ID"]],
			},
		), { status: 200, headers: { "Content-Type": "application/json" } });
	};

	try {
		const response = await worker.fetch(new Request("https://worker.test", {
			method: "POST",
			headers: {
				Authorization: "Bearer test-token",
				"X-Spreadsheet-ID": "test-sheet",
				"X-Action": "preview",
			},
			body: [
				"Date,Description,Amount",
				"2026-07-02,Local Market,-39.95",
			].join("\n"),
		}));
		const payload = await response.json();

		assert.equal(response.status, 200);
		assert.equal(payload.rows.length, 1);
		assert.equal(requests.length, 4);
		assert.equal(requests[2].method, "PUT");
		assert.ok(requests[2].url.includes("Sheet1!C1"));
		assert.deepEqual(JSON.parse(requests[2].body).values, [["Category"]]);
	} finally {
		globalThis.fetch = originalFetch;
	}
});

test("preview creates a missing Sheet1 tab and initializes its headers", async () => {
	const originalFetch = globalThis.fetch;
	const requests = [];
	const headers = ["Timestamp", "Amount", "Category", "Description", "Expense Type", "Transaction ID", "Category ID"];
	globalThis.fetch = async (url, init = {}) => {
		requests.push({ url: String(url), method: init.method || "GET", body: init.body });
		if (String(url).includes("?fields=sheets.properties")) {
			return new Response(JSON.stringify({ sheets: [] }), {
				status: 200,
				headers: { "Content-Type": "application/json" },
			});
		}
		if (String(url).includes(":batchUpdate")) {
			return new Response(JSON.stringify({ replies: [{}] }), {
				status: 200,
				headers: { "Content-Type": "application/json" },
			});
		}
		if (init.method === "PUT") {
			return new Response(JSON.stringify({ updatedCells: 6 }), {
				status: 200,
				headers: { "Content-Type": "application/json" },
			});
		}
		return new Response(JSON.stringify({ values: [headers] }), {
			status: 200,
			headers: { "Content-Type": "application/json" },
		});
	};

	try {
		const response = await worker.fetch(new Request("https://worker.test", {
			method: "POST",
			headers: {
				Authorization: "Bearer test-token",
				"X-Spreadsheet-ID": "test-sheet",
				"X-Action": "preview",
			},
			body: "Date,Description,Amount\n2026-07-02,Local Market,-39.95",
		}));
		const payload = await response.json();

		assert.equal(response.status, 200);
		assert.equal(payload.rows.length, 1);
		assert.equal(requests.length, 5);
		assert.equal(requests[1].method, "POST");
		assert.ok(requests[1].url.includes(":batchUpdate"));
		assert.equal(requests[2].method, "PUT");
		assert.deepEqual(JSON.parse(requests[2].body).values, [headers]);
	} finally {
		globalThis.fetch = originalFetch;
	}
});

test("preview creates a replacement spreadsheet when the saved document was deleted", async () => {
	const originalFetch = globalThis.fetch;
	const requests = [];
	const newSpreadsheetId = "replacement-sheet-id";
	const headers = ["Timestamp", "Amount", "Category", "Description", "Expense Type", "Transaction ID", "Category ID"];
	globalThis.fetch = async (url, init = {}) => {
		requests.push({ url: String(url), method: init.method || "GET", body: init.body });
		if (String(url).includes("?fields=sheets.properties")) {
			return new Response(JSON.stringify({
				error: { message: "Requested entity was not found." },
			}), { status: 404, headers: { "Content-Type": "application/json" } });
		}
		if (String(url) === "https://sheets.googleapis.com/v4/spreadsheets") {
			return new Response(JSON.stringify({ spreadsheetId: newSpreadsheetId }), {
				status: 200,
				headers: { "Content-Type": "application/json" },
			});
		}
		if (init.method === "PUT") {
			return new Response(JSON.stringify({ updatedCells: 6 }), {
				status: 200,
				headers: { "Content-Type": "application/json" },
			});
		}
		return new Response(JSON.stringify({ values: [headers] }), {
			status: 200,
			headers: { "Content-Type": "application/json" },
		});
	};

	try {
		const response = await worker.fetch(new Request("https://worker.test", {
			method: "POST",
			headers: {
				Authorization: "Bearer test-token",
				"X-Spreadsheet-ID": "deleted-sheet-id",
				"X-Action": "preview",
			},
			body: "Date,Description,Amount\n2026-07-02,Local Market,-39.95",
		}));
		const payload = await response.json();

		assert.equal(response.status, 200);
		assert.equal(payload.spreadsheetId, newSpreadsheetId);
		assert.equal(payload.spreadsheetCreated, true);
		assert.equal(payload.rows.length, 1);
		assert.equal(requests.length, 5);
		assert.equal(requests[1].method, "POST");
		assert.equal(requests[1].url, "https://sheets.googleapis.com/v4/spreadsheets");
		assert.equal(requests[2].method, "PUT");
		assert.deepEqual(JSON.parse(requests[2].body).values, [headers]);
		assert.ok(requests[3].url.includes(encodeURIComponent(newSpreadsheetId)));
	} finally {
		globalThis.fetch = originalFetch;
	}
});

test("preview completes a recognized four-column legacy header", async () => {
	const originalFetch = globalThis.fetch;
	const requests = [];
	const legacyHeaders = ["Timestamp", "Amount", "Type", "Description"];
	globalThis.fetch = async (url, init = {}) => {
		requests.push({ url: String(url), method: init.method || "GET", body: init.body });
		if (String(url).includes("?fields=sheets.properties")) {
			return new Response(JSON.stringify({
				sheets: [{ properties: { title: "Sheet1" } }],
			}), { status: 200, headers: { "Content-Type": "application/json" } });
		}
		if (init.method === "PUT") {
			return new Response(JSON.stringify({ updatedCells: 1 }), {
				status: 200,
				headers: { "Content-Type": "application/json" },
			});
		}
		return new Response(JSON.stringify({ values: [legacyHeaders] }), {
			status: 200,
			headers: { "Content-Type": "application/json" },
		});
	};

	try {
		const response = await worker.fetch(new Request("https://worker.test", {
			method: "POST",
			headers: {
				Authorization: "Bearer test-token",
				"X-Spreadsheet-ID": "legacy-sheet",
				"X-Action": "preview",
			},
			body: "Date,Description,Amount\n2026-07-02,Local Market,-39.95",
		}));
		const payload = await response.json();

		assert.equal(response.status, 200);
		assert.equal(payload.rows.length, 1);
		assert.equal(requests.length, 5);
		assert.ok(requests[2].url.includes("Sheet1!C1"));
		assert.deepEqual(JSON.parse(requests[2].body).values, [["Category"]]);
		assert.ok(requests[3].url.includes("Sheet1!E1"));
		assert.deepEqual(JSON.parse(requests[3].body).values, [[
			"Expense Type",
			"Transaction ID",
			"Category ID",
		]]);
	} finally {
		globalThis.fetch = originalFetch;
	}
});

test("user keyword mappings assign active subcategories and stable IDs", () => {
	const categoryId = "housing-bills:electricity";
	const config = {
		categories: [{ id: categoryId, parentId: "housing-bills", name: "Electricity", active: true }],
		mappings: [{ keyword: "ONCOR", categoryId, matchType: "keyword" }],
	};
	const rows = normalize([
		["Date", "Description", "Amount"],
		["2026-10-01", "ONCOR ELECTRIC AUTOPAY", "-118.32"],
	], config);
	assert.equal(rows[0].category, "Electricity");
	assert.equal(rows[0].categoryId, categoryId);
	assert.equal(rows[0].categoryMatched, true);
});

test("exact confirmed mappings outrank keyword mappings and archived categories are ignored", () => {
	const config = {
		categories: [
			{ id: "food-household:groceries", parentId: "food-household", name: "Groceries", active: true },
			{ id: "housing-bills:water", parentId: "housing-bills", name: "Water", active: false, archived: true },
		],
		mappings: [
			{ keyword: "MARKET", categoryId: "food-household:groceries", matchType: "keyword" },
			{ keyword: "LOCAL MARKET PAYMENT", categoryId: "housing-bills:water", matchType: "exact" },
		],
	};
	const rows = normalize([
		["Date", "Description", "Amount"],
		["2026-10-01", "LOCAL MARKET PAYMENT", "-18.00"],
	], config);
	assert.equal(rows[0].category, "Groceries");
	assert.equal(rows[0].categoryId, "food-household:groceries");
});

test("conflicting equally specific user keywords are flagged for review", () => {
	const config = {
		categories: [
			{ id: "a:coffee", parentId: "a", name: "Coffee", active: true },
			{ id: "b:food", parentId: "b", name: "Food", active: true },
		],
		mappings: [
			{ keyword: "SHOP", categoryId: "a:coffee" },
			{ keyword: "SHOP", categoryId: "b:food" },
		],
	};
	const rows = normalize([
		["Date", "Description", "Amount"],
		["2026-10-01", "SHOP PURCHASE", "-18.00"],
	], config);
	assert.equal(rows[0].categoryAmbiguous, true);
	assert.equal(rows[0].categoryMatched, false);
});







test("statement preview uses the authenticated caller's category configuration header", async () => {
	const originalFetch = globalThis.fetch;
	globalThis.fetch = async (url) => {
		if (String(url).includes("?fields=sheets.properties")) {
			return new Response(JSON.stringify({ sheets: [{ properties: { title: "Sheet1" } }] }), { status: 200 });
		}
		if (String(url).includes("Expense%20Categories")) {
			return new Response(JSON.stringify({ error: { message: "Range not found" } }), { status: 400 });
		}
		return new Response(JSON.stringify({ values: [["Timestamp", "Amount", "Category", "Description", "Expense Type", "Transaction ID", "Category ID"]] }), { status: 200 });
	};
	try {
		const config = {
			categories: [{ id: "housing-bills:electricity", parentId: "housing-bills", name: "Electricity", active: true }],
			mappings: [{ keyword: "ONCOR", categoryId: "housing-bills:electricity", matchType: "keyword" }],
		};
		const configHeader = Buffer.from(JSON.stringify(config)).toString("base64url");
		const response = await worker.fetch(new Request("https://worker.test", {
			method: "POST",
			headers: { Authorization: "Bearer test-token", "X-Spreadsheet-ID": "test-sheet", "X-Action": "preview", "X-Category-Config": configHeader },
			body: "Date,Description,Amount\n2026-10-01,ONCOR ELECTRIC AUTOPAY,-118.32",
		}));
		const payload = await response.json();
		assert.equal(response.status, 200);
		assert.equal(payload.rows[0].category, "Electricity");
		assert.equal(payload.rows[0].categoryId, "housing-bills:electricity");
	} finally {
		globalThis.fetch = originalFetch;
	}
});
