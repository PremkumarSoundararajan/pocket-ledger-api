import { MerchantClassificationIndex, readMerchantClassifications, saveImportCategoryExceptions } from './merchant-classifications.js';
import { expenseType, recurringMerchants, suggestExpenseType } from './expense-types.js';
import {retiredEmailRequest} from './email-retirement.js';
import {possibleEmailDuplicate} from './historical-email-duplicates.js';
const RULES = {
    "Food / Household": [
        "restaurant", "restoran", "kitchen", "food", "cafe", "coffee", "bakery", "deli", "diner",
        "bistro", "eatery", "grill", "bbq", "barbecue", "steakhouse", "taqueria", "pizza", "burger",
        "sushi", "ramen", "noodle", "thai", "indian", "chinese", "mexican", "biryani", "hyderabad",
        "dosa", "tandoor", "curry", "kebab", "shawarma", "smoothie", "boba", "ice cream",
        "creamery", "tiffin", "fine dining", "food court", "canteen", "mess", "catering", "juice",
        "grocery", "groceries", "supermarket", "hypermarket", "butcher", "produce", "fresh market",
        "farmers market", "wet market", "food mart", "minimart", "mini market", "convenience store",
        "kirana", "dhaba", "mithai", "sweets", "chai", "chaayos", "chai point", "udupi",
        "saravana bhavan", "haldiram", "bikanervala", "paradise biryani", "behrouz",
        "biryani by kilo", "barista", "cafe coffee day", "third wave", "dmart", "d mart",
        "big bazaar", "reliance fresh", "reliance smart", "more supermarket", "spencer s",
        "nature s basket", "star bazaar", "bigbasket", "big basket", "blinkit", "zepto",
        "instamart", "jiomart", "licious", "milkbasket", "country delight", "amul", "swiggy",
        "zomato", "eatsure", "magicpin", "patel brothers", "india bazaar", "indian grocery",
        "shrifoods", "hareli", "mamak", "kopitiam", "nasi", "roti canai", "teh tarik", "kedai makan",
        "warung", "gerai", "satay", "laksa", "char kuey teow", "mee goreng", "zus coffee", "tealive",
        "old town white coffee", "secret recipe", "marrybrown", "sushi king", "texas chicken", "lotus s",
        "lotus", "aeon big", "mydin", "econsave", "jaya grocer", "village grocer", "99 speedmart",
        "speedmart", "kk mart", "foodpanda", "grabfood", "grab food", "shopeefood", "fairprice", "ntuc",
        "sheng siong", "cold storage", "gojek food", "mr diy", "mr d i y", "mr dollar", "daiso",
        "kedai runcit", "loblaws", "no frills", "real canadian superstore", "superstore", "sobeys",
        "farm boy", "freshco", "food basics", "save on foods", "longo s", "t t supermarket", "iga",
        "provigo", "tim hortons", "a w", "harvey s", "swiss chalet", "mary brown", "second cup",
        "freshii", "pizza pizza", "booster juice", "ritual", "skip the dishes", "skipthedishes",
        "foodora", "kroger", "albertsons", "tom thumb", "randalls", "safeway", "vons", "h e b", "heb",
        "central market", "aldi", "lidl", "trader joe", "whole foods", "sprouts", "publix", "wegmans",
        "costco", "sam s club", "sams club", "target", "walmart", "wal mart", "wm supercenter",
        "winco", "food lion", "stop shop", "meijer", "fiesta mart", "h mart", "99 ranch", "braums",
        "instacart", "shipt", "fresh direct", "thrive market", "amazon fresh", "starbucks", "dunkin",
        "peet s", "dutch bros", "caribou coffee", "mcdonald", "burger king", "wendy s", "taco bell",
        "chick fil a", "subway", "chipotle", "panda express", "domino", "pizza hut", "papa john",
        "little caesars", "kfc", "popeyes", "sonic drive", "whataburger", "in n out", "five guys",
        "panera", "ihop", "denny s", "waffle house", "olive garden", "applebee", "chili s",
        "buffalo wild wings", "dairy queen", "jack in the box", "jersey mike", "jimmy john",
        "raising cane", "wingstop", "cracker barrel", "texas roadhouse", "outback", "red lobster",
        "cheesecake factory", "cava", "sweetgreen", "shake shack", "culver", "zaxby", "el pollo loco",
        "qdoba", "krispy kreme", "baskin robbins", "cold stone", "jamba", "doordash", "uber eats",
        "ubereats", "grubhub", "postmates", "caviar", "seamless", "gopuff", "tesco", "sainsbury",
        "asda", "morrisons", "waitrose", "co op", "greggs", "pret a manger", "nando s", "deliveroo",
        "just eat", "coles", "woolworths", "carrefour", "lulu hypermarket", "spinneys", "talabat",
        "dollar tree", "dollar general", "family dollar", "five below", "ikea", "container store",
        "bed bath", "homegoods", "household", "cleaning supplies", "detergent", "paper towel",
        "clorox", "tissue", "toiletries", "pet food", "petco", "petsmart", "chewy", "veterinar",
        "vet clinic", "pet shop", "diapers", "baby formula", "lpg cylinder refill",
        "किराना", "रेस्तरां", "सब्जी", "超市", "餐厅", "菜市场", "مطعم", "بقالة",
    ],
    "Transport": [
        "fuel", "petrol", "diesel", "gasoline", "gas station", "gas", "petrol pump", "filling station",
        "shell", "chevron", "exxon", "mobil", "bp", "texaco", "valero", "sunoco", "marathon",
        "citgo", "phillips 66", "conoco", "76", "circle k", "quiktrip", "racetrac", "buc ee s",
        "murphy usa", "murphy express", "love s travel", "pilot", "flying j", "casey s", "wawa",
        "sheetz", "speedway", "kwik trip", "kum go", "petro canada", "esso", "husky", "ultramar",
        "indian oil", "iocl", "bharat petroleum", "bpcl", "hpcl", "hp petrol", "reliance petrol",
        "nayara", "jio bp", "petronas", "caltex", "petron", "setel", "ev charging", "chargepoint",
        "electrify america", "evgo", "supercharger", "tata power ev", "ather grid", "पेट्रोल", "加油站",
        "uber", "lyft", "ola", "ola cabs", "rapido", "namma yatri", "meru cabs", "grab", "grabcar",
        "gojek", "careem", "taxi", "cab", "bolt", "waymo", "transit", "bus", "bus pass", "train",
        "metro card", "metro rail", "delhi metro", "namma metro", "dmrc", "bmrcl", "rapidkl",
        "rapid kl", "ktm", "lrt", "mrt", "monorail", "ttc", "translink", "presto", "opus card",
        "compass card", "go transit", "via rail", "mta", "bart", "septa", "cta", "trinity metro",
        "amtrak", "greyhound", "flixbus", "redbus", "irctc", "indian railways", "railway",
        "ezlink", "ez link", "simplygo", "comfortdelgro", "oyster", "tfl", "national rail",
        "trainline", "myki", "opal card", "ferry", "toll", "fastag", "fastag recharge", "touch n go",
        "tng", "ntta", "txtag", "ez pass", "e zpass", "fastrak", "sunpass", "407 etr", "salik",
        "parking", "parkmobile", "spothero", "green p", "impark", "garage fee", "valet",
        "car wash", "oil change", "jiffy lube", "valvoline", "autozone", "o reilly", "advance auto",
        "napa auto", "pep boys", "tire", "tyre", "discount tire", "firestone", "midas", "mavis",
        "meineke", "auto repair", "car service", "garage", "mechanic", "body shop", "puc",
        "vehicle inspection", "puspakom", "dmv", "dps", "jpj", "road tax", "vehicle registration",
        "license plate", "number plate", "rto", "towing", "roadside",
    ],
    "Housing / Bills": [
        "rent", "rental", "lease", "apartment", "apartments", "pg rent", "flat", "landlord",
        "property management", "mortgage", "home loan", "home loan emi", "hoa", "homeowners", "property tax",
        "house tax", "cukai pintu", "quit rent", "cukai tanah", "council tax", "municipal",
        "corporation tax", "city of", "county of", "town of", "society maintenance",
        "maintenance charges", "housing society", "condo fee", "strata", "nobroker", "magicbricks",
        "public storage", "extra space", "cubesmart", "storage unit", "किराया", "房租",
        "electric", "electricity", "electricity bill", "power bill", "bescom", "tata power",
        "adani electricity", "bses", "msedcl", "tneb", "tangedco", "kseb", "torrent power",
        "tnb", "tenaga", "oncor", "txu", "reliant", "green mountain", "direct energy", "hydro one",
        "bc hydro", "hydro quebec", "toronto hydro", "enbridge", "fortis", "centerpoint",
        "duke energy", "pg e", "con edison", "atmos energy", "atmos", "fort worth water",
        "fort worth wate", "british gas", "octopus energy", "dewa", "rhythm ops", "rhythm ops llc",
        "gas bill", "gas cylinder", "lpg", "indane", "hp gas", "bharat gas", "mahanagar gas",
        "gas malaysia", "water bill", "water board", "bwssb", "jal board", "syabas", "air selangor",
        "indah water", "iwk", "thames water", "sewer", "utility", "utilities", "trash", "garbage",
        "waste management", "republic services", "sanitation", "बिजली", "电费",
        "internet", "broadband", "wifi", "fiber", "fibre", "act fibernet", "hathway", "airtel",
        "jio", "vodafone idea", "bsnl", "tata play", "tata sky", "dth", "recharge", "unifi",
        "tm unifi", "time internet", "maxis", "celcom", "digi", "u mobile", "yes 4g", "astro",
        "singtel", "starhub", "etisalat", "rogers", "bell canada", "bell mts", "telus", "fido",
        "koodo", "virgin plus", "freedom mobile", "shaw", "videotron", "comcast", "xfinity",
        "spectrum", "cox", "optimum", "frontier", "fios", "centurylink", "google fi", "verizon",
        "att", "at t", "t mobile", "tmobile", "mint mobile", "cricket wireless", "visible",
        "boost mobile", "us mobile", "phone bill", "mobile bill", "mobile plan", "postpaid",
        "prepaid", "wireless", "cellular", "dish network", "directv", "sky broadband", "vodafone",
        "o2", "bt broadband", "home depot", "lowe s", "ace hardware", "menards", "canadian tire",
        "rona", "bunnings", "plumber", "plumbing", "hvac", "air conditioning", "pest control",
        "terminix", "orkin", "lawn", "landscaping", "handyman", "roofing", "electrician", "carpenter",
        "locksmith", "urban company", "housekeeping", "maid", "cleaning service", "home warranty",
        "adt", "simplisafe", "vivint", "ring protect", "insurance", "home insurance", "car insurance",
        "auto insurance", "renters insurance", "geico", "progressive", "state farm", "allstate",
        "farmers insurance", "usaa", "liberty mutual", "nationwide", "intact", "desjardins",
        "acko", "digit insurance", "policybazaar",
    ],
    "Health & Wellness": [
        "pharmacy", "pharmacies", "chemist", "chemist warehouse", "farmasi", "drugstore", "drug store",
        "cvs", "walgreens", "rite aid", "duane reade", "shoppers drug mart", "rexall", "london drugs",
        "jean coutu", "pharmaprix", "lawtons", "guardian", "watsons", "caring pharmacy", "big pharmacy",
        "boots", "superdrug", "apollo pharmacy", "apollo", "medplus", "netmeds", "pharmeasy",
        "1mg", "tata 1mg", "wellness forever", "rx", "prescription", "medicine", "medicines",
        "medical", "medical store", "health", "hospital", "clinic", "klinik", "urgent care",
        "emergency room", "doctor", "physician", "practo", "pediatric", "dermatolog", "cardiolog",
        "orthopedic", "obgyn", "gynecolog", "dental", "dentist", "orthodont", "optometrist",
        "eye care", "vision", "lenskart", "lenscrafters", "visionworks", "warby parker", "hearing",
        "labcorp", "quest diagnostics", "lab test", "pathology", "diagnostic", "dynacare", "lifelabs",
        "thyrocare", "dr lal", "metropolis", "radiology", "imaging", "mri", "kpj", "pantai",
        "gleneagles", "sunway medical", "fortis hospital", "max healthcare", "manipal", "aiims",
        "nhs", "medicare", "ohip", "copay", "deductible", "teladoc", "health insurance", "blue cross",
        "bcbs", "aetna", "cigna", "unitedhealth", "humana", "kaiser", "star health", "care health",
        "药房", "医院", "दवा", "अस्पताल", "صيدلية", "therapy", "therapist", "counseling", "counselling",
        "psychiatr", "psycholog", "chiropract", "physiotherapy", "physical therapy", "acupuncture",
        "ayurveda", "headspace", "calm app", "gym", "fitness", "planet fitness", "la fitness",
        "anytime fitness", "24 hour fitness", "orangetheory", "crossfit", "equinox", "ymca", "yoga",
        "pilates", "peloton", "gold s gym", "life time", "cult fit", "cultfit", "curves", "f45",
        "celebrity fitness", "vitamin", "supplement", "gnc", "vitamin shoppe", "protein",
    ],
    "Financial Obligations": [
        "bank", "fee", "fees", "charges", "interest", "credit card", "loan", "finance charge",
        "service charge", "atm fee", "atm withdrawal", "atm", "overdraft", "nsf", "late fee",
        "annual fee", "wire fee", "maintenance fee", "foreign transaction", "forex markup",
        "card payment", "minimum payment", "bill payment credit card", "cred", "amex",
        "american express", "discover", "capital one", "citi card", "synchrony", "barclays",
        "chase credit", "hdfc credit", "sbi card", "icici credit", "axis credit", "paypal fee",
        "stripe fee", "gst on charges", "stamp duty", "processing fee", "emi", "personal loan",
        "car loan", "auto loan", "car payment", "student loan", "education loan", "ptptn", "nelnet",
        "navient", "sallie mae", "mohela", "great lakes", "osap", "nslsc", "bajaj finserv", "affirm",
        "klarna", "afterpay", "sezzle", "atome", "paylater", "buy now pay later", "tax", "tax payment",
        "income tax", "advance tax", "gst", "tds", "irs", "cra", "lhdn", "hmrc", "ato", "turbotax",
        "h r block", "hr block", "cpa", "accountant", "chartered accountant", "attorney", "lawyer",
        "advocate", "legal fee", "notary", "court fee", "traffic fine", "parking fine", "challan",
        "citation", "speeding ticket", "life insurance", "lic", "lic premium", "term insurance",
        "fidelity", "vanguard", "schwab", "robinhood", "etrade", "wealthsimple", "questrade",
        "zerodha", "groww", "upstox", "kuvera", "coin by zerodha", "401k", "ira", "rrsp", "tfsa",
        "resp", "epf", "kwsp", "ppf", "nps", "sip", "mutual fund", "brokerage", "investment",
        "fixed deposit", "recurring deposit", "chit fund", "retirement", "remittance", "western union",
        "wise", "remitly", "xoom", "moneygram", "worldremit", "instarem", "wire transfer",
        "money transfer", "swift",
    ],
    "Lifestyle / Misc": [
        "netflix", "hulu", "disney", "hotstar", "jiocinema", "zee5", "sonyliv", "hbo max", "spotify",
        "apple music", "youtube", "prime video", "amazon prime", "paramount", "peacock", "crave",
        "audible", "kindle", "crunchyroll", "sling", "viu", "iflix", "astro go", "gaana", "jiosaavn",
        "wynk", "subscription", "membership", "patreon", "substack", "icloud", "google one",
        "dropbox", "adobe", "microsoft 365", "openai", "chatgpt", "claude", "github", "playstation",
        "xbox", "nintendo", "steam", "twitch", "app store", "google play", "cinema", "movie",
        "theater", "theatre", "bookmyshow", "pvr", "inox", "gsc", "tgv", "cineplex", "amc", "regal",
        "cinemark", "concert", "ticketmaster", "stubhub", "eventbrite", "bowling", "arcade",
        "topgolf", "golf", "six flags", "water park", "zoo", "museum", "amusement", "theme park",
        "genting", "casino", "lottery", "escape room", "karaoke", "liquor", "wine", "wine shop",
        "total wine", "spec s", "lcbo", "saq", "beer", "brewery", "taproom", "pub", "bar", "lounge",
        "nightclub", "amazon", "amzn", "ebay", "etsy", "flipkart", "myntra", "ajio", "nykaa", "meesho",
        "tata cliq", "shopee", "lazada", "zalora", "temu", "shein", "aliexpress", "best buy",
        "apple store", "apple com", "croma", "reliance digital", "vijay sales", "micro center",
        "shopify", "nike", "adidas", "puma", "zara", "h m", "old navy", "gap", "uniqlo", "padini",
        "nordstrom", "macy s", "kohl s", "tj maxx", "marshalls", "ross dress", "burlington",
        "winners", "sephora", "ulta", "bath body works", "hobby lobby", "michaels", "barnes noble",
        "gamestop", "wayfair", "tanishq", "titan", "clothing", "apparel", "shoes", "jewelry",
        "jewellery", "electronics", "fashion", "boutique", "salon", "barber", "haircut",
        "great clips", "supercuts", "spa", "nail", "massage", "waxing", "threading", "beauty parlour",
        "beauty parlor", "grooming", "airbnb", "vrbo", "hotel", "motel", "resort", "hostel", "oyo",
        "treebo", "marriott", "hilton", "hyatt", "taj hotels", "expedia", "booking com", "agoda",
        "kayak", "makemytrip", "goibibo", "cleartrip", "ixigo", "airline", "airlines", "airways",
        "american airlines", "delta air", "united air", "southwest air", "jetblue", "spirit air",
        "frontier air", "alaska air", "air canada", "westjet", "air india", "indigo", "spicejet",
        "vistara", "akasa", "airasia", "malaysia airlines", "firefly", "batik air", "emirates",
        "etihad", "qatar airways", "singapore airlines", "ryanair", "easyjet", "qantas", "hertz",
        "avis", "enterprise rent", "rent a car", "car rental", "turo", "visa fee", "passport",
        "tsa", "duty free", "gift", "gifts", "flowers", "florist", "1800flowers", "hallmark",
        "donation", "charity", "temple", "church", "mosque", "masjid", "gurdwara", "zakat",
        "sedekah", "gofundme", "red cross", "tuition", "school fees", "school", "college",
        "university", "udemy", "coursera", "skillshare", "byju", "unacademy", "bookstore", "books",
        "usps", "ups store", "fedex", "dhl", "post office", "india post", "pos laju", "canada post",
        "shipping", "daycare", "toys", "hobby", "photography", "printing",
    ],
}
const CREDITS = ["direct deposit", "payroll", "paycheck", "pay check", "wages", "salary", "refund", "reversal", "cashback", "cash back", "interest earned", "dividend", "credit adjustment", "credit memo", "reimbursement", "zelle received", "zelle from", "venmo cashout", "venmo from"];
const TRANSFERS = ["payment thank you", "payment thankyou", "autopay", "auto pay", "automatic payment", "online payment", "online pmt", "credit card payment", "credit card pymt", "card payment", "card pymt", "cc payment", "cc pymt", "payment received", "payment to card", "payment to credit card", "credit card transfer", "transfer to card", "transfer to credit card", "internal transfer", "account transfer"];
function isInternalTransfer(description) {
	// PayPal labels merchant payments "INST XFER" (Disney+, Uber...): expenses, not transfers.
	const value = String(description || "").toUpperCase().replace(/\bINST XFER\b/g, " ");
	return /\b(?:MONEYLINE|A2A(?:\s+XFERS)?|TRANSFER|XFER|WIRE|ACH|CONTRIBUTION|DISTRIBUTION)\b/.test(value) ||
		["FID BKG SVC", "FIDELITY", "DIGITAL FEDERAL"].some(x => value.includes(x));
}
const RANGE = "Sheet1!A1:G";
export default {
	async fetch(req, env = {}) {
        if (new URL(req.url).pathname.startsWith('/email/')) return retiredEmailRequest(req, env);
		if (req.method === "OPTIONS") return cors();
		if (req.method === "GET") return out({
			status: "ok",
            emailCapture: false,
            emailCaptureRetired: true,
			reviewPreview: true,
            expenseTypeReview: true,
            merchantClassificationReview: true,
			reviewedCategoryUpdates: true,
		});
		if (req.method !== "POST") return out({
			error: "Method not allowed"
		}, 405);
		try {
			const auth = req.headers.get("Authorization") || "";
			if (!/^Bearer\s+\S+$/i.test(auth)) return out({
				error: "Missing or invalid Authorization Bearer token"
			}, 401);
			const token = auth.replace(/^Bearer\s+/i, "");
			const id = req.headers.get("X-Spreadsheet-ID");
			if (!id) return out({
				error: "Missing X-Spreadsheet-ID header"
			}, 400);
			const body = await req.text();
			if (!body.trim()) return out({
				error: "Empty CSV payload received"
			}, 400);
			const action = (req.headers.get("X-Action") || "import").toLowerCase();
			if (action !== "preview" && action !== "import") return out({ error: "X-Action must be preview or import" }, 400);
			let txs;
			const ensured = await ensureTransactionTab(id, token);
            const spreadsheetId = ensured.spreadsheetId;
			const spreadsheetCreated = spreadsheetId !== id;
			const base = `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(spreadsheetId)}/values/${encodeURIComponent(RANGE)}`;
			const get = await fetch(base, {
					headers: {
						Authorization: `Bearer ${token}`,
					}
				}),
				sheet = await json(get);
			if (!get.ok) throw Error(`Google Sheets read error: ${sheet.error?.message||get.statusText}`);
			const hasSheetData = (sheet.values || []).some(row =>
				row.some(value => String(value ?? "").trim()));
			if (!hasSheetData) {
				const headers = ["Timestamp", "Amount", "Category", "Description", "Expense Type", "Transaction ID", "Category ID"];
				await writeSheetValues(spreadsheetId, token, "Sheet1!A1:G1", [headers], "header initialization");
				sheet.values = [headers];
			}
			const headerMigrations = validate(sheet.values?.[0]);
			if (headerMigrations.category) {
				await writeSheetValues(spreadsheetId, token, "Sheet1!C1", [["Category"]], "header update");
			}
			if (headerMigrations.missingTrailingHeaders.length) {
				const startColumn = String.fromCharCode(65 + (sheet.values[0].length));
				await writeSheetValues(
					spreadsheetId,
					token,
					`Sheet1!${startColumn}1`,
					[headerMigrations.missingTrailingHeaders],
					"header completion",
				);
			}
			let categoryConfig = await readExpenseCategoryConfig(spreadsheetId, token);
            if (!categoryConfig) categoryConfig = categoryConfigFromHeader(req.headers.get("X-Category-Config"));
            txs = normalize(parseCsv(body), categoryConfig, action === "import");
            // key -> sheet row number (1-based, header is row 1). Built from the live sheet on every request.
			const seen = new Map();
            const merchantState = await readMerchantClassifications(spreadsheetId, token, ensured.merchantTabExists);
            const merchantIndex = new MerchantClassificationIndex(merchantState.records.values());
            const importExceptions = [];
            const patterns = recurringMerchants((sheet.values || []).slice(1).map(row => [dateOf(row[0]), ...row.slice(1)]));
			(sheet.values || []).slice(1).forEach((row, index) => {
				const rk = rowKey(row);
				if (rk && !seen.has(rk)) {
					seen.set(rk, { row: index + 2, category: String(row[2] || "").trim(), expenseType: expenseType(row[4]), transactionId: String(row[5] || "") });
				}
			});
			const allowDuplicates = (req.headers.get("X-Allow-Duplicates") || "").toLowerCase() === "true";
			let filtered = 0,
				duplicates = 0,
				skippedDuplicates = 0;
			const previewRows = [];
			const values = [];
			const categoryUpdates = [];
			for (const t of txs) {
				if (!t) {
					filtered++;
					continue;
				}
				const k = key(t.date, t.amount, t.description);
				const emailMatchIndex = (sheet.values || []).findIndex((row,index) => index>0 && String(row[5]||'').startsWith('email:') && possibleEmailDuplicate({date:t.date,amount:t.amount,merchant:t.description},row));
                const emailMatch = emailMatchIndex < 0 ? undefined : {row:emailMatchIndex+1,category:String(sheet.values[emailMatchIndex][2]||''),expenseType:expenseType(sheet.values[emailMatchIndex][4]),transactionId:sheet.values[emailMatchIndex][5]};
                const existing = (k ? seen.get(k) : undefined) || emailMatch;
				const duplicateRow = existing?.row;
				const duplicate = existing !== undefined;
                if (!t.categoryReviewed) {
                    const master = merchantIndex.categoryFor(t.description, existing?.transactionId);
                    if (master.category) { t.category = master.category; t.categoryId = master.categoryId || ''; t.categoryMatched = true; }
                }
                const transactionId = (duplicate && (t.importAnyway || allowDuplicates)) ? crypto.randomUUID() : existing?.transactionId || crypto.randomUUID();
                if (action === 'import' && (t.categoryReviewed || t.expenseTypeReviewed)) {
                    const id = 't:' + transactionId;
                    importExceptions.push({...(merchantState.records.get(id)?.deleted ? {} : merchantState.records.get(id)), id, kind: 'transaction', transactionId,
                        ...(t.categoryReviewed ? {category: t.category, categoryId: t.categoryId} : {}), ...(t.expenseTypeReviewed ? {expenseType: t.expenseType} : {}), deleted: false});
                }
                if (!t.expenseTypeReviewed) {
                    const typeRule = merchantIndex.merchantFor(t.description);
                    const typeException = merchantIndex.exceptions.get(existing?.transactionId);
                    t.expenseType = typeException?.expenseType ?? typeRule?.expenseType ?? (existing ? existing.expenseType : t.expenseTypeProvided ? t.expenseType : suggestExpenseType(t, patterns));
                    t.expenseTypeSource = existing && existing.expenseType !== 'Unknown' ? 'Saved' : t.expenseType === 'Regular' ? 'Suggested' : 'Needs Review';
                }
				if (duplicate) {
					duplicates++;
				}
				if (action === "preview") {
					previewRows.push({
						...t,
						duplicate,
						duplicateRow: duplicate ? duplicateRow : null,
						existingCategory: duplicate ? existing.category : null,
                        existingExpenseType: duplicate ? existing.expenseType : null,
                        transactionId: duplicate ? existing.transactionId || null : null,
					});
					continue;
				}
				if (duplicate && !t.importAnyway && !allowDuplicates) {
					if ((t.category && t.category !== existing.category) || t.expenseTypeReviewed || t.categoryReviewed) {
						categoryUpdates.push({ row: duplicateRow, category: t.category, categoryId: t.categoryId, expenseType: t.expenseTypeReviewed ? t.expenseType : undefined, transactionId: !existing.transactionId && t.categoryReviewed ? transactionId : undefined });
					} else {
						skippedDuplicates++;
					}
					continue;
				}
				values.push([t.date, t.amount, t.category, t.description, t.expenseType, transactionId, t.categoryId || ""]);
			}
			if (action === "preview") return out({ status: "preview", spreadsheetId, spreadsheetCreated, rows: previewRows, filtered, duplicates });
			await saveImportCategoryExceptions(spreadsheetId, token, merchantState, importExceptions);
            if (categoryUpdates.length) {
				await updateCategories(spreadsheetId, token, categoryUpdates);
			}
			if (!values.length) {
                return out({
				status: "success",
				spreadsheetId,
				spreadsheetCreated,
				appended: 0,
				updated: categoryUpdates.length,
				duplicates,
				skipped: skippedDuplicates,
				filtered,
				message: categoryUpdates.length
					? `Updated ${categoryUpdates.length} existing transaction classification${categoryUpdates.length === 1 ? "" : "s"}.`
					: "No new expenses to import."
			});
			}
			const post = await fetch(`${base}:append?valueInputOption=RAW&insertDataOption=INSERT_ROWS`, {
				method: "POST",
				headers: {
					Authorization: `Bearer ${token}`,
					"Content-Type": "application/json"
				},
				body: JSON.stringify({
					values
				})
			});
			const result = await json(post);
			if (!post.ok) throw Error(`Google Sheets append error: ${result.error?.message||post.statusText}`);
			return out({
				status: "success",
				spreadsheetId,
				spreadsheetCreated,
				appended: values.length,
				updated: categoryUpdates.length,
				duplicates,
				skipped: skippedDuplicates,
				filtered,
				updates: result.updates
			});
		} catch (e) {
			return out({
				error: e?.message || "Unexpected error"
			}, 500);
		}
	},
    async scheduled() { /* Retired: stale cron invocations must never access Gmail. */ }
};

function parseCsv(s) {
	const out = [];
	let row = [],
		v = "",
		q = false;
	for (let i = 0; i < s.length; i++) {
		let c = s[i];
		if (q) {
			if (c === '"' && s[i + 1] === '"') {
				v += '"';
				i++;
			} else if (c === '"') q = false;
			else v += c;
		} else if (c === '"') q = true;
		else if (c === ",") {
			row.push(v);
			v = "";
		} else if (c === "\n" || c === "\r") {
			if (c === "\r" && s[i + 1] === "\n") i++;
			row.push(v);
			v = "";
			if (row.some(x => x.trim())) out.push(row);
			row = [];
		} else v += c;
	}
	row.push(v);
	if (row.some(x => x.trim())) out.push(row);
	return out;
}

function head(x) {
	return String(x || "").toLowerCase().replace(/[^a-z0-9]+/g, "");
}

function norm(x) {
	return String(x || "").normalize("NFKD").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
}

export function normalize(rows, categoryConfig = null, honorReviewed = false) {
	let hi = 0;
	for (let i = 0; i < Math.min(40, rows.length); i++) {
		const x = rows[i].map(head).join(" ");
		if (/date|timestamp/.test(x) && /description|remarks|particulars|narration|merchant|payee|details/.test(x) && /amount|debit|credit|withdrawal|deposit/.test(x)) {
			hi = i;
			break;
		}
	}
	const h = rows[hi].map(head),
		find = a => {
			for (const alias of a) {
				const exact = h.indexOf(alias);
				if (exact >= 0) return exact;
			}
			for (const alias of a) {
				const partial = h.findIndex(value => value.includes(alias));
				if (partial >= 0) return partial;
			}
			return -1;
		};
	const di = find(["transactiondate", "posteddate", "postdate", "postingdate", "valuedate", "transdate", "txndate", "date", "timestamp"]),
		si = find(["transactiondescription", "description", "transactionremarks", "transactiondetails", "remarks", "particulars", "narration", "memo", "merchant", "payee", "details", "narrative", "name"]),
		bi = find(["debitamount", "withdrawalamount", "withdrawal", "debit"]),
		ci = find(["creditamount", "depositamount", "deposit", "credit"]),
		ai = find(["transactionamount", "purchaseamount", "amount", "totalamount", "sum", "cost"]),
		ti = find(["transactiontype", "debitcredit", "creditdebit", "drcr", "type"]),
		ii = find(["importanyway", "appendduplicate"]),
        ei = find(["expensetype"]),
        eri = find(["expensetypereviewed"]),
        cri = find(["categoryreviewed"]);
	if (di < 0 || si < 0 || (ai < 0 && bi < 0 && ci < 0)) throw Error("Could not detect date, description, amount/debit CSV columns.");
	const out = [];
	const hasSignedAmountConvention = ai >= 0 &&
		rows.slice(hi + 1).some(row => amount(row[ai]) < 0);
	for (const r of rows.slice(hi + 1)) {
		const desc = String(r[si] || "").trim(),
			d = norm(desc),
			typ = norm(ti < 0 ? "" : r[ti]);
		const internalTransfer = isInternalTransfer(desc);
        const userMappedCategory = resolveCategory(desc, r, h, categoryConfig, null);
		if (!desc || ["credit", "deposit", "refund", "income", "interest", "dividend", "cr"].includes(typ) || ["credit adjustment", "ach credit", "direct deposit"].some(x => typ.includes(x)) || CREDITS.some(x => d.includes(x)) || (!internalTransfer && !userMappedCategory.categoryId && TRANSFERS.some(x => d.includes(x))) || (/\bpayment to\b.*\bcard\b/.test(d) && !internalTransfer)) {
			out.push(null);
			continue;
		}
		if (/\bbill\s*pay\b/.test(d) && !["fort worth water", "atmos energy", "atmos", "water bill", "water utility", "electricity bill", "power bill", "gas bill", "utility bill", "rhythm ops"].some(x => d.includes(x))) {
			out.push(null);
			continue;
		}
		let raw;
		if (bi >= 0) {
			if (!String(r[bi] || "").trim()) {
				out.push(null);
				continue;
			}
			raw = r[bi];
		} else if (ci >= 0) {
			out.push(null);
			continue;
		} else {
			raw = r[ai];
		}
		const a = amount(raw);
		if (!Number.isFinite(a) || !a ||
			(hasSignedAmountConvention && a >= 0) ||
			(!hasSignedAmountConvention && a < 0 && !['debit', 'dr', 'withdrawal', 'purchase', 'expense'].includes(typ))) {
			out.push(null);
			continue;
		}
		const date = dateOf(r[di]);
		if (!date) throw Error(`Invalid transaction date: ${r[di]||"blank"}`);
		const category = cat(desc);
		const suggested = internalTransfer ? "Transfers" : category || "Lifestyle / Misc";
		const resolved = resolveCategory(desc, r, h, categoryConfig, null, honorReviewed);
		const finalCategory = resolved.category || suggested;
		out.push({
			date,
			amount: Math.abs(a),
			category: finalCategory,
            categoryReviewed: honorReviewed && cri >= 0 && ["true","1","yes"].includes(norm(r[cri])),
			categoryId: resolved.categoryId || parentIdForName(finalCategory),
			categoryMatched: !resolved.ambiguous && (internalTransfer || Boolean(category) || Boolean(resolved.categoryId)),
			categoryAmbiguous: resolved.ambiguous === true,
			description: desc,
			importAnyway: ii >= 0 && ["true", "1", "yes"].includes(norm(r[ii])),
			expenseType: honorReviewed && ei >= 0 ? expenseType(r[ei]) : 'Unknown',
            expenseTypeProvided: honorReviewed && ei >= 0,
            expenseTypeReviewed: honorReviewed && eri >= 0 && ['true','1','yes'].includes(norm(r[eri])),
            expenseTypeSource: honorReviewed && eri >= 0 && ['true','1','yes'].includes(norm(r[eri])) ? 'Confirmed' : 'Needs Review'
		});
	}
	return out;
}

const NOISE=/^(?:(?:sq|tst|pp|pos|debit|purchase|checkcard|recurring|ach|upi|ecom|dp|vps)\s+)+/;
function ruleNorm(s){return String(s||"").normalize("NFKC").toLowerCase().replace(/&/g," ").replace(/[\W_]+/g," ").trim().replace(NOISE,"");}
function compileKeyword(keyword){const k=ruleNorm(keyword);if(/^[\x00-\x7F]+$/.test(keyword))return new RegExp(`(?<![\\p{L}\\p{N}_])${k}(?:s|es)?(?![\\p{L}\\p{N}_])`,`u`);return new RegExp(k,`u`);}
const MATCH_RULES=Object.entries(RULES).flatMap(([category,keywords])=>keywords.map(keyword=>({pattern:compileKeyword(keyword),length:ruleNorm(keyword).length,category}))).sort((a,b)=>b.length-a.length);
function cat(s){const text=ruleNorm(s);for(const rule of MATCH_RULES)if(rule.pattern.test(text))return rule.category;return null;}

function amount(v) {
	let s = String(v ?? "").trim().replace(/[,$₹€£]|\b(?:rs|rm|inr|myr|usd|cad|aud|eur|gbp)\b/gi, "").replace(/\s/g, "");
	if (/^\(.*\)$/.test(s)) s = "-" + s.slice(1, -1);
	return s ? Number(s) : NaN;
}

function dateOf(v) {
	if (v == null || !String(v).trim()) return null;
	const s = String(v).trim();
	let d;
	if (/^\d{8}$/.test(s)) d = new Date(Date.UTC(+s.slice(0, 4), +s.slice(4, 6) - 1, +s.slice(6, 8)));
	else if (/^\d+(\.\d+)?$/.test(s) && +s < 100000) d = new Date(Date.UTC(1899, 11, 30) + Number(s) * 86400000);
	else {
		const m = s.match(/^(\d{1,2})[/.\-](\d{1,2})[/.\-](\d{4})/);
		if (m) {
			const a = +m[1],
				b = +m[2],
				mo = a > 12 ? b : b > 12 ? a : a,
				day = a > 12 ? a : b > 12 ? b : b;
			d = new Date(Date.UTC(+m[3], mo - 1, day));
		} else {
			const x = new Date(s);
			if (!isNaN(x)) d = new Date(Date.UTC(x.getUTCFullYear(), x.getUTCMonth(), x.getUTCDate()));
		}
	}
	return d && !isNaN(d) ? d.toISOString().slice(0, 10) : null;
}

function key(date, a, desc) {
	const d = dateOf(date),
		n = amount(a);
	return d && Number.isFinite(n) ? `${d}|${Math.abs(n).toFixed(2)}|${String(desc||"").trim().replace(/\s+/g," ").toLowerCase()}` : null;
}

function rowKey(r) {
	if (!r || r.length < 2) return null;
	let a = r[1],
		d = r[3] || "";
	if (!Number.isFinite(amount(a)) && Number.isFinite(amount(r[2]))) {
		a = r[2];
		d = r[1] || "";
	}
	return key(r[0], a, d);
}

async function ensureTransactionTab(spreadsheetId, token) {
	const spreadsheetUrl = `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(spreadsheetId)}?fields=sheets.properties(sheetId,title)`;
	let response = await fetch(spreadsheetUrl, {
		headers: { Authorization: `Bearer ${token}` }
	});
	let spreadsheet = await json(response);
	if (!response.ok) {
		if (response.status === 404) {
			return {spreadsheetId: await createTransactionSpreadsheet(token), merchantTabExists: false};
		}
		throw Error(`Google Sheets spreadsheet lookup error: ${spreadsheet.error?.message||response.statusText}`);
	}
	if (spreadsheet.sheets?.some(sheet => sheet.properties?.title === "Sheet1")) return {spreadsheetId, merchantTabExists: spreadsheet.sheets.some(sheet => sheet.properties?.title === "Merchant Classifications")};

	const createUrl = `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(spreadsheetId)}:batchUpdate`;
	response = await fetch(createUrl, {
		method: "POST",
		headers: {
			Authorization: `Bearer ${token}`,
			"Content-Type": "application/json"
		},
		body: JSON.stringify({
			requests: [{ addSheet: { properties: { title: "Sheet1" } } }]
		})
	});
	const result = await json(response);
	const created = response.ok;
	if (!response.ok) {
		response = await fetch(spreadsheetUrl, {
			headers: { Authorization: `Bearer ${token}` }
		});
		spreadsheet = await json(response);
		if (!response.ok ||
			!spreadsheet.sheets?.some(sheet => sheet.properties?.title === "Sheet1")) {
			throw Error(`Google Sheets worksheet creation error: ${result.error?.message||"Could not create the Sheet1 tab."}`);
		}
	}
	if (created) {
		await writeSheetValues(spreadsheetId, token, "Sheet1!A1:G1", [
			["Timestamp", "Amount", "Category", "Description", "Expense Type", "Transaction ID", "Category ID"]
		], "header initialization");
	}
	return {spreadsheetId, merchantTabExists: spreadsheet.sheets?.some(sheet => sheet.properties?.title === "Merchant Classifications") || false};
}

async function createTransactionSpreadsheet(token) {
	const response = await fetch("https://sheets.googleapis.com/v4/spreadsheets", {
		method: "POST",
		headers: {
			Authorization: `Bearer ${token}`,
			"Content-Type": "application/json"
		},
		body: JSON.stringify({
			properties: { title: "Expense Tracker DB" }
		})
	});
	const result = await json(response);
	if (!response.ok) {
		throw Error(`Google Sheets spreadsheet creation error: ${result.error?.message||response.statusText}`);
	}
	const spreadsheetId = result.spreadsheetId;
	if (typeof spreadsheetId !== "string" || !spreadsheetId) {
		throw Error("Google Sheets spreadsheet creation error: Google did not return a spreadsheet ID.");
	}
	await writeSheetValues(spreadsheetId, token, "Sheet1!A1:G1", [
		["Timestamp", "Amount", "Category", "Description", "Expense Type", "Transaction ID", "Category ID"]
	], "header initialization");
	return spreadsheetId;
}

async function writeSheetValues(spreadsheetId, token, range, values, operation) {
	const url = `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(spreadsheetId)}/values/${encodeURIComponent(range)}?valueInputOption=RAW`;
	const response = await fetch(url, {
		method: "PUT",
		headers: {
			Authorization: `Bearer ${token}`,
			"Content-Type": "application/json"
		},
		body: JSON.stringify({ values })
	});
	const result = await json(response);
	if (!response.ok) {
		throw Error(`Google Sheets ${operation} error: ${result.error?.message||response.statusText}`);
	}
}

async function updateCategories(spreadsheetId, token, updates) {
	const url = `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(spreadsheetId)}/values:batchUpdate`;
	const data = updates.flatMap(({ row, category, categoryId, expenseType: reviewedType, transactionId }) => [
        ...(transactionId ? [{ range: `Sheet1!F${row}`, values: [[transactionId]] }] : []),
        ...(reviewedType !== undefined ? [{ range: `Sheet1!E${row}`, values: [[reviewedType]] }] : []),
		{ range: `Sheet1!C${row}`, values: [[category]] },
		{ range: `Sheet1!G${row}`, values: [[categoryId || ""]] },
	]);
	const response = await fetch(url, {
		method: "POST",
		headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
		body: JSON.stringify({ valueInputOption: "RAW", data }),
	});
	const result = await json(response);
	if (!response.ok) throw Error(`Google Sheets category update error: ${result.error?.message || response.statusText}`);
	return result;
}

function validate(r) {
	if (!r?.length) throw Error("Google Sheet layout is invalid. Expected Pocket Ledger transaction headers; no data was read or written.");
	const h = r.map(x => String(x || "").trim().toLowerCase());
	const valid = h.length >= 4 &&
		["timestamp", "date"].includes(h[0]) && h[1] === "amount" &&
		["type", "category"].includes(h[2]) && h[3] === "description" &&
		(h.length < 5 || h[4] === "expense type") &&
		(h.length < 6 || h[5] === "transaction id") &&
		(h.length < 7 || h[6] === "category id");
	if (!valid) throw Error("Google Sheet layout is invalid. Expected Pocket Ledger transaction headers; no data was read or written.");
	return {
		category: h[2] === "type",
		missingTrailingHeaders: ["Timestamp", "Amount", "Category", "Description", "Expense Type", "Transaction ID", "Category ID"].slice(h.length),
	};
}async function json(r) {
	try {
		return await r.json()
	} catch {
		return {};
	}
}

function activeConfigCategories(config) {
	return Array.isArray(config?.categories) ? config.categories.filter(category => category?.active !== false && category?.archived !== true) : [];
}

function categoryConfigFromHeader(header) {
	if (!header) return null;
	try {
		let encoded = String(header).replace(/-/g, "+").replace(/_/g, "/");
		while (encoded.length % 4) encoded += "=";
		const bytes = Uint8Array.from(atob(encoded), character => character.charCodeAt(0));
		const decoded = JSON.parse(new TextDecoder().decode(bytes));
		return decoded && Array.isArray(decoded.categories) && Array.isArray(decoded.mappings) ? decoded : null;
	} catch {
		return null;
	}
}
async function readExpenseCategoryConfig(spreadsheetId, token) {
	const url = `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(spreadsheetId)}/values/${encodeURIComponent("'Expense Categories'!A2:A2")}`;
	const response = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
	if (response.status === 400 || response.status === 404) return null;
	const payload = await json(response);
	if (!response.ok) throw Error(`Google Sheets category configuration read error: ${payload.error?.message || response.statusText}`);
	const encoded = payload.values?.[0]?.[0];
	if (!encoded || !String(encoded).trimStart().startsWith("{")) return null;
	try { return JSON.parse(encoded); }
	catch { throw Error("Expense Categories configuration is invalid JSON."); }
}

function resolveCategory(description, row, headers, config, fallback, honorReviewed = false) {
	const active = activeConfigCategories(config);
	const categoryIndex = headers.findIndex(value => ["category", "expensecategory"].includes(value));
	const categoryIdIndex = headers.indexOf("categoryid");
	const chosenName = categoryIndex >= 0 ? String(row[categoryIndex] || "").trim() : "";
	const chosenId = categoryIdIndex >= 0 ? String(row[categoryIdIndex] || "").trim() : "";
	if (honorReviewed && (chosenName || chosenId)) {
		const chosen = active.find(category => (chosenId && category.id === chosenId) || (chosenName && head(category.name) === head(chosenName)));
		if (chosen) return { category: chosen.name, categoryId: chosen.id };
		const parent = parentIdForName(chosenName);
        if (parent) return {category: chosenName, categoryId: parent};
        if (head(chosenName) === head("Transfers")) return { category: "Transfers", categoryId: "transfers" };
	}
	const normalized = norm(description);
	const mappings = Array.isArray(config?.mappings) ? config.mappings : [];
	const matches = mappings.filter(mapping => {
		const destination = active.find(category => category.id === mapping.categoryId);
		if (!destination) return false;
		const keyword = norm(mapping.keyword || mapping.description || "");
		if (!keyword) return false;
		return mapping.matchType === "exact" ? normalized === keyword : normalized.includes(keyword);
	}).sort((a, b) => Number(b.matchType === "exact") - Number(a.matchType === "exact") || norm(b.keyword || b.description || "").length - norm(a.keyword || a.description || "").length);
	if (matches.length) {
		const best = matches[0];
		const tied = matches.filter(item => norm(item.keyword || item.description || "").length === norm(best.keyword || best.description || "").length && item.categoryId !== best.categoryId);
		if (tied.length) return { category: "", categoryId: "", ambiguous: true };
		if (!tied.length) {
			const category = active.find(item => item.id === best.categoryId);
			return { category: category.name, categoryId: category.id };
		}
	}
	if (fallback == null) return { category: "", categoryId: "" };
	const category = active.find(item => head(item.name) === head(fallback));
	return category ? { category: category.name, categoryId: category.id } : { category: fallback, categoryId: parentIdForName(fallback) };
}

function parentIdForName(name) {
	return ({ "Housing / Bills": "housing-bills", "Food / Household": "food-household", "Transport": "transport", "Financial Obligations": "financial-obligations", "Health & Wellness": "health-wellness", "Lifestyle / Misc": "lifestyle-misc", "Transfers": "transfers" })[name] || "";
}
function cors() {
  return new Response(null, {
    status: 204,
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Spreadsheet-ID, X-Action, X-Allow-Duplicates, X-Category-Config, Accept, Origin",
      "Access-Control-Max-Age": "86400",
    },
  });
}

function out(x, s = 200) {
  return new Response(JSON.stringify(x), {
    status: s,
    headers: {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Spreadsheet-ID, X-Action, X-Allow-Duplicates, X-Category-Config, Accept, Origin",
    },
  });
}














