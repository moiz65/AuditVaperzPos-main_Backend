const express = require("express");
const mysql = require("mysql");
const dotenv = require("dotenv");
const cors = require("cors");
const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");
const app = express();
const PORT = 5000;
require("dotenv").config({ path: "./backend/.env" });

// Allow requests from your frontend
const corsOptions = {
  origin: "https://audit-vaperz-pos.vercel.app", // Change to your frontend URL (e.g., your domain
};

app.use(cors(corsOptions));
app.use(express.json());

// MySQL connection setup
// const db = mysql.createConnection({
//   database: process.env.DB_NAME,
//   host: process.env.DB_HOST,
//   user: process.env.DB_USERNAME,
//   password: process.env.DB_PASSWORD,
// });

const db = mysql.createPool({
  host: process.env.DB_HOST,
  user: process.env.DB_USERNAME,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  port: process.env.DB_PORT || 3306,
});

// Checking connection to MySQL
// db.connect((err) => {
//   if (err) {
//     console.error("Error connecting to MySQL:", err.message);
//     return;
//   }
//   console.log("Connected to MySQL");
// });

// ✅ Simple test query to verify the pool works
db.query("SELECT 1", (err) => {
  if (err) {
    console.error("❌ Database connection failed:", err.message);
  } else {
    console.log("✅ Connected to MySQL (via pool)");
  }
});

// API endpoint to check database connection
app.get("/api/check-connection", (req, res) => {
  if (db.state === "authenticated") {
    res.json({ message: "Welcome to Database" });
  } else {
    res.status(500).json({ message: "Database connection failed" });
  }
});

app.post("/api/register", async (req, res) => {
  const { email, password, role } = req.body;

  console.log("Received request:", req.body); // Debugging log

  if (!email || !password || !role) {
    console.error("Missing fields in request");
    return res.status(400).json({ error: "All fields are required." });
  }

  try {
    // Check if user already exists
    const checkQuery = "SELECT * FROM audituser WHERE email = ?";
    db.query(checkQuery, [email], async (err, results) => {
      if (err) {
        console.error("Database error during user check:", err);
        return res.status(500).json({ error: "Database error." });
      }

      if (results.length > 0) {
        console.warn("User already exists:", email);
        return res.status(409).json({ error: "User already exists." });
      }

      // Hash the password
      const saltRounds = 10;
      const hashedPassword = await bcrypt.hash(password, saltRounds);

      // Insert user into the database
      const created_date = new Date();
      const insertQuery =
        "INSERT INTO audituser (email, password, role, created_date) VALUES (?, ?, ?, ?)";

      db.query(insertQuery, [email, hashedPassword, role, created_date], (err, result) => {
        if (err) {
          console.error("Error inserting user into DB:", err);
          return res.status(500).json({ error: "Registration failed." });
        }

        console.log("User registered successfully:", email);
        res.status(201).json({
          message: "User registered successfully.",
          user: { id: result.insertId, email, role },
        });
      });
    });
  } catch (err) {
    console.error("Unexpected server error:", err);
    res.status(500).json({ error: "Server error." });
  }
});


// login route
app.post("/api/login", (req, res) => {
  const { email, password } = req.body;

  console.log("Received login request:", { email, password }); // Log incoming request

  if (!email || !password) {
    return res.status(400).json({ error: "Email and password are required." });
  }

  const query = "SELECT * FROM audituser WHERE email = ?";
  db.query(query, [email], (err, results) => {
    if (err) {
      console.error("Database query error:", err);
      return res.status(500).json({ error: "Database error." });
    }

    if (results.length === 0) {
      console.warn("No user found with the provided email:", email); // Log no user found
      return res.status(401).json({ error: "Invalid email or password." });
    }

    const user = results[0];
    console.log("User found:", user); // Log user details (exclude password)

    bcrypt.compare(password, user.password, (err, isMatch) => {
      if (err) {
        console.error("Bcrypt comparison error:", err);
        return res.status(500).json({ error: "Password comparison error." });
      }

      if (!isMatch) {
        console.warn("Password mismatch for user:", email); // Log mismatch
        return res.status(401).json({ error: "Invalid email or password." });
      }

      const token = jwt.sign(
        { id: user.id },
        process.env.JWT_SECRET || "default_secret_key",
        { expiresIn: "1h" }
      );

      res.json({ token, user: { id: user.id, email: user.email, role: user.role} });
    });
  });
});

// Define the /api/sales route
app.get("/api/sales", (req, res) => {
  const { search, startDate, endDate } = req.query; // Get search, startDate, and endDate from request query

  let query = "SELECT * FROM sales";
  const params = [];

  // Build the query dynamically based on the provided parameters
  if (search || (startDate && endDate)) {
    query += " WHERE";
  }

  if (search) {
    query += " (id LIKE ? OR reference_code LIKE ?)";
    const searchTerm = `%${search}%`;
    params.push(searchTerm, searchTerm);
  }

  if (startDate && endDate) {
    if (search) {
      query += " AND";
    }
    query += " created_at BETWEEN ? AND ?";
    params.push(startDate, endDate);
  }

  db.query(query, params, (err, results) => {
    if (err) {
      console.error("Error fetching sales data:", err);
      res.status(500).send("Server error");
      return;
    }
    res.json(results);
  });
});
// Define the /api/sales-items route
app.get("/api/sales_items", (req, res) => {
  const { search, startDate, endDate } = req.query; // Get search, startDate, and endDate from request query

  // Base query for fetching sales items with the required JOINs
  let query = `
        SELECT 
            si.id AS sale_item_id,
            si.sale_id,
            si.net_unit_price AS sale_net_unit_price,
            si.quantity AS sale_quantity,
            si.discount_amount AS sale_discount_amount,
            si.sub_total AS sale_sub_total,
            si.created_at AS sale_created_at,
            s.reference_code,
            s.payment_status,
            s.payment_type,
            p.name AS product_name,
            p.product_cost
        FROM 
            sale_items si
        JOIN 
            sales s ON si.sale_id = s.id
        JOIN 
            products p ON si.product_id = p.id
    `;
  const params = [];

  // Dynamically add filtering conditions
  if (search || (startDate && endDate)) {
    query += " WHERE"; // Start WHERE clause
  }

  // Add search filter
  if (search) {
    query += " (s.reference_code LIKE ? OR p.name LIKE ? OR si.id LIKE ?)";
    const searchTerm = `%${search}%`;
    params.push(searchTerm, searchTerm, searchTerm);
  }

  // Add date filter
  if (startDate && endDate) {
    if (search) {
      query += " AND"; // Add AND if search filter exists
    }
    query += " si.created_at BETWEEN ? AND ?";
    params.push(startDate, endDate);
  }

  // Execute the query with the parameters
  db.query(query, params, (err, results) => {
    if (err) {
      console.error("Error fetching sales items data:", err);
      res.status(500).send("Server error");
      return;
    }
    res.json(results); // Send the query results as JSON response
  });
});
// Define the /api/sales-items route
app.get("/api/stocks", (req, res) => {
  const { search, startDate, endDate } = req.query; // Get search, startDate, and endDate from request query

  // Base query for fetching sales items with the required JOINs
  let query = `
    SELECT 
        ms.id AS manage_stock_id,
        ms.product_id,
        ms.quantity AS stock_quantity,
        ms.updated_at AS stock_updated_at,
        p.name AS product_name,
        p.product_cost,
        p.brand_id,
        b.id AS brand_id,
        b.name AS brand_name
    FROM 
        manage_stocks ms
    JOIN 
        products p ON ms.product_id = p.id
    JOIN 
        brands b ON p.brand_id = b.id
    `;
  const params = [];

  // Dynamically add filtering conditions
  if (search || (startDate && endDate)) {
    query += " WHERE"; // Start WHERE clause
  }

  // Add search filter
  if (search) {
    query += " (p.name LIKE ? OR ms.id LIKE ?)";
    const searchTerm = `%${search}%`;
    params.push(searchTerm, searchTerm, searchTerm);
  }

  // Add date filter
  if (startDate && endDate) {
    if (search) {
      query += " AND"; // Add AND if search filter exists
    }
    query += " ms.updated_at BETWEEN ? AND ?";
    params.push(startDate, endDate);
  }

  // Execute the query with the parameters
  db.query(query, params, (err, results) => {
    if (err) {
      console.error("Error fetching sales items data:", err);
      res.status(500).send("Server error");
      return;
    }
    res.json(results); // Send the query results as JSON response
  });
});

app.get("/api/interface", (req, res) => {
  const { startDate, endDate } = req.query;

  // Build dynamic WHERE clause for date filtering
  let dateFilter = "";
  const queryParams = [];

  if (startDate && endDate) {
    dateFilter = `
      WHERE 
        (s.created_at BETWEEN ? AND ? 
        OR si.created_at BETWEEN ? AND ?) 
    `;
    queryParams.push(startDate, endDate, startDate, endDate);
  } else if (startDate) {
    dateFilter = `
      WHERE 
        (s.created_at >= ? 
        OR si.created_at >= ?)
    `;
    queryParams.push(startDate, startDate);
  } else if (endDate) {
    dateFilter = `
      WHERE 
        (s.created_at <= ? 
        OR si.created_at <= ?)
    `;
    queryParams.push(endDate, endDate);
  }

  // Main query for sales data
  let salesQuery = `
    SELECT 
      s.id AS sale_id,
      s.paid_amount,
      s.grand_total,
      s.discount AS sale_discount,
      s.payment_status AS payment_status,
      s.payment_type AS payment_type,
      si.id AS sale_item_id,
      si.net_unit_price AS sale_net_unit_price,
      si.quantity AS sale_quantity,
      si.created_at AS sale_item_created_at,
      p.product_cost AS product_cost,
      COALESCE(ms.quantity, 0) AS stock_quantity
    FROM 
      sale_items si
    LEFT JOIN 
      sales s ON si.sale_id = s.id
    LEFT JOIN 
      products p ON si.product_id = p.id
    LEFT JOIN 
      manage_stocks ms ON p.id = ms.product_id
    ${dateFilter}
  `;

  // Stock query
  let stockQuery = `
    SELECT 
      p.id AS product_id,
      p.product_cost AS product_cost,
      COALESCE(ms.quantity, 0) AS stock_quantity
    FROM 
      products p
    LEFT JOIN 
      manage_stocks ms ON p.id = ms.product_id
  `;

  // Execute sales query
  db.query(salesQuery, queryParams, (err, salesResults) => {
    if (err) {
      console.error("Error fetching sales data:", err);
      res.status(500).send("Server error");
      return;
    }

    // Execute stock query
    db.query(stockQuery, [], (err, stockResults) => {
      if (err) {
        console.error("Error fetching stock data:", err);
        res.status(500).send("Server error");
        return;
      }

      // Process sales data
      const salesData = salesResults.reduce((acc, row) => {
        const {
          sale_id,
          paid_amount,
          grand_total,
          sale_discount,
          payment_status,
          payment_type,
          sale_item_id,
          sale_net_unit_price,
          sale_quantity,
          sale_item_created_at,
          product_cost,
          stock_quantity,
        } = row;

        let sale = acc.find((s) => s.sale_id === sale_id);
        if (!sale) {
          sale = {
            sale_id: sale_id || null,
            paid_amount: paid_amount || 0,
            grand_total: grand_total || 0,
            discount: sale_discount || 0,
            payment_status: payment_status || "N/A",
            payment_type: payment_type || "N/A",
            sale_items: [],
          };
          acc.push(sale);
        }

        if (sale_item_id) {
          sale.sale_items.push({
            sale_item_id,
            net_unit_price: sale_net_unit_price || 0,
            quantity: sale_quantity || 0,
            created_at: sale_item_created_at,
            product_cost: product_cost || 0,
            stock_quantity: stock_quantity || 0,
          });
        }

        return acc;
      }, []);

      // Process stock data
      const stockData = stockResults.map((row) => ({
        product_id: row.product_id || null,
        product_cost: parseFloat(row.product_cost) || 0,
        stock_quantity: parseFloat(row.stock_quantity) || 0,
      }));

      // Return combined response
      res.json({ salesData, stockData });
    });
  });
});

app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});
