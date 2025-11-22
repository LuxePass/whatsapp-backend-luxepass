/**
 * Middleware to capture raw body for webhook signature verification
 * Note: This middleware must be used BEFORE express.json() for webhook routes
 */
export function rawBodyMiddleware(req, res, next) {
	if (req.path === "/webhook" && req.method === "POST") {
		let data = "";
		req.setEncoding("utf8");

		req.on("data", (chunk) => {
			data += chunk;
		});

		req.on("end", () => {
			try {
				req.rawBody = Buffer.from(data, "utf8");
				req.body = JSON.parse(data);
				next();
			} catch (error) {
				next(error);
			}
		});
	} else {
		next();
	}
}

