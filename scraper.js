// This is a template for a Node.js scraper on morph.io (https://morph.io)

var cheerio = require("cheerio");
var request = require("request");
var sqlite3 = require("sqlite3").verbose();

function initDatabase(callback) {
  // Set up sqlite database.
  var db = new sqlite3.Database("data.sqlite");
  db.serialize(function() {
    db.run(
      "CREATE TABLE IF NOT EXISTS data (key PRIMARY KEY, id TEXT, date TEXT, name TEXT, price INT)"
    );
    callback(db);
  });
}

function updateRow(db, id, name, price) {
  let date = new Date();
  let dateString =
    date.getFullYear() + "-" + (date.getMonth() + 1) + "-" + date.getDate();

  // Insert some data.
  var statement = db.prepare(`INSERT INTO data(key, id, date, name, price)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(key) DO UPDATE SET
      price=excluded.price
  `);
  statement.run(`${dateString}-${id}`, id, dateString, name, price);
  statement.finalize();
}

function readRows(db) {
  // Read some data.
  db.each("SELECT name, date, price FROM data", function(err, row) {
    console.log(`${row.date} ${row.name}: ${row.price}`);
  });
}

function getSourceId(url) {
  return url.match(/i=([\d]+?)\&/)[1];
}

function fetchPage(url, callback) {
  // Use request to read in pages.
  request(url, function(error, response, body) {
    if (error) {
      console.log("Error requesting page: " + error);
      return;
    }

    callback(body);
  });
}

function run(db) {
  // Use request to read in pages.
  fetchPage(
    "https://www.klwines.com/Products?&filters=sv2_206!20&limit=500&offset=0",
    function(body) {
      // Use cheerio to find things in the page with css selectors.
      var $ = cheerio.load(body);

      var elements = $(".result");
      // console.log("Elements", elements);
      elements.each(function() {
        var link = $(this)
          .find(".result-desc > a[href^='/p/i']")
          .first();

        var id = getSourceId(link.attr("href"));
        var name = link.text().trim();
        var price = parseInt(
          $(this)
            .find(".price strong")
            .text()
            .trim()
            .replace(/[\$\.]/g, "")
        );
        console.log("id", id);
        console.log("name", name);
        console.log("price", price);

        updateRow(db, id, name, price);
      });

      db.close();
    }
  );
}

initDatabase(run);
