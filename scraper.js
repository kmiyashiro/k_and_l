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

function initDatabase(callback) {
  // Set up sqlite database.
  const db = new sqlite3.Database('data.sqlite')
  db.serialize(function () {
    db.run(
      'CREATE TABLE IF NOT EXISTS data (key PRIMARY KEY, id TEXT, category TEXT, date TEXT, name TEXT, price INT)'
    )
    callback(db)
  })
}

function updateRow(db, id, category, name, price) {
  console.log('UPDATE', id, category, name, price)
  let date = new Date()
  let dateString =
    date.getFullYear() + '-' + (date.getMonth() + 1) + '-' + date.getDate()

  // Insert some data.
  const statement = db.prepare(`INSERT INTO data(key, id, category, date, name, price)
    VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(key) DO UPDATE SET
      price=excluded.price
  `)
  statement.run(`${dateString}-${id}`, id, category, dateString, name, price)
  statement.finalize()
  console.log('FINALIZE', id, category, name, price)
}

function readRows(db) {
  // Read some data.
  db.each('SELECT name, date, price FROM data', function (err, row) {
    console.log(`${row.date} ${row.name}: ${row.price}`)
  })
}

async function getLoginRequestToken() {
  const response = await axios(LOGIN_URL)
  const $ = cheerio.load(response.data)
  return $('[name="__RequestVerificationToken"]').val()
}

// Login so we can see the hidden insider prices
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

function getSourceId(url) {
  return url.match(/i=([\d]+?)\&/)[1]
}

async function getCategories() {
  const CATEGORY_SELECTOR = '#category-menu-container-Variety .category-link a'

  const response = await axios('https://www.klwines.com/Spirits')
  const $ = cheerio.load(response.data)
  const categoryLinks = $(CATEGORY_SELECTOR)
  if (categoryLinks.length === 0) {
    throw new Error('Could not find category links')
  }

  const hrefs = []

  categoryLinks.each(function (_, link) {
    hrefs.push($(this).attr('href'))
  })

  return hrefs.map((href) => {
    const match = href.match(/\!(\d+)[^\d]/)
    if (!match) {
      console.log('missing match', href)
    } else {
      return match[1]
    }
  })
}

async function scrapeCategory(category, db) {
  console.log('CATEGORY', category)
  const url = `https://www.klwines.com/Products?&filters=sv2_206!${category}&limit=500&offset=0`
  const response = await axios(url)
  const $ = cheerio.load(response.data)

  const elements = $('.tf-product')
  console.log(`Found ${elements.length} elements`)
  if (elements.length === 0) {
    console.log(`Did not find any results for ${url}`)
    return
  }
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

    updateRow(db, id, category, name, price)
  })
  return elements.length
}

async function run(db) {
  console.log('running')
  console.log('getting cookie')
  await getCookie()

  console.log('fetching categories')
  const categories = await getCategories()
  console.log('found categories:', categories.length)

  let updatedCount = 0

  while (categories.length) {
    updatedCount += await scrapeCategory(categories.pop(), db)
    await new Promise((resolve) => setTimeout(resolve, 2000))
  }

  if (updatedCount === 0) {
    throw new Error('Nothing found, possibly broken selectors')
  }

  db.close()
}

initDatabase(run)
