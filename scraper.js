// This is a template for a Node.js scraper on morph.io (https://morph.io)

const cheerio = require('cheerio')
const querystring = require('querystring')
const axios = require('axios').default
const tough = require('tough-cookie')
const axiosCookieJarSupport = require('axios-cookiejar-support').default
const sqlite3 = require('sqlite3').verbose()

const { Cookie } = tough

axiosCookieJarSupport(axios)

const cookieJar = new tough.CookieJar()
axios.defaults.jar = cookieJar
axios.defaults.withCredentials = true

const LOGIN_URL = 'https://www.klwines.com/account/login'
const USERNAME = process.env.MORPH_KL_USER
const PASSWORD = process.env.MORPH_KL_PASSWORD

async function getLoginRequestToken() {
  const response = await axios(LOGIN_URL)
  const $ = cheerio.load(response.data)
  return $('[name="__RequestVerificationToken"]').val()
}

async function getCookie() {
  const loginRequestToken = await getLoginRequestToken()
  const formData = {
    __RequestVerificationToken: loginRequestToken,
    Email: USERNAME,
    Password: PASSWORD,
    ReturnUrl: '',
    'Login.x': '15',
    'Login.y': '5',
  }

  return axios(LOGIN_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'User-Agent':
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_11_2) AppleWebKit/601.3.9 (KHTML, like Gecko) Version/9.0.2 Safari/601.3.9',
    },
    data: querystring.stringify(formData),
  })
}

function initDatabase(callback) {
  // Set up sqlite database.
  const db = new sqlite3.Database('data.sqlite')
  db.serialize(function () {
    db.run(
      'CREATE TABLE IF NOT EXISTS data (key PRIMARY KEY, id TEXT, date TEXT, name TEXT, price INT)'
    )
    callback(db)
  })
}

function updateRow(db, id, name, price) {
  console.log('UPDATE', id, name, price)
  let date = new Date()
  let dateString =
    date.getFullYear() + '-' + (date.getMonth() + 1) + '-' + date.getDate()

  // Insert some data.
  const statement = db.prepare(`INSERT INTO data(key, id, date, name, price)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(key) DO UPDATE SET
      price=excluded.price
  `)
  statement.run(`${dateString}-${id}`, id, dateString, name, price)
  statement.finalize()
  console.log('FINALIZE', id, name, price)
}

function readRows(db) {
  // Read some data.
  db.each('SELECT name, date, price FROM data', function (err, row) {
    console.log(`${row.date} ${row.name}: ${row.price}`)
  })
}

function getSourceId(url) {
  return url.match(/i=([\d]+?)\&/)[1]
}

async function run(db) {
  console.log('running')
  console.log('getting cookie')
  await getCookie()
  // Use request to read in pages.
  console.log('fetching page')
  const response = await axios(
    'https://www.klwines.com/Products?&filters=sv2_206!20&limit=500&offset=0'
  )
  // Use cheerio to find things in the page with css selectors.
  const $ = cheerio.load(response.data)

  const elements = $('.tf-product')
  console.log(`Found ${elements.length} elements`)
  // console.log("Elements", elements);
  elements.each(function () {
    const link = $(this).find(".tf-product-header > a[href^='/p/i']").first()

    const id = getSourceId(link.attr('href'))
    const name = link.text().trim()
    const priceNode = $(this).find('.tf-price span:nth-of-type(2)')
    const price = parseInt(
      priceNode
        .text()
        .trim()
        .replace(/[\$\.\*]/g, '')
    )
    console.log('id:', id, 'name:', name, 'price:', price)

    updateRow(db, id, name, price)
  })

  db.close()
}

initDatabase(run)
