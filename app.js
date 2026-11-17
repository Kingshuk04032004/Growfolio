let data = [];

const $ = x => document.getElementById(x);

const money = n =>
  new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 0
  }).format(Number(n) || 0);

const esc = x =>
  String(x ?? "").replace(
    /[&<>"']/g,
    c =>
      ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#39;"
      })[c]
  );


// Yahoo Finance
const Y = "https://query1.finance.yahoo.com";

// NIFTY 50 benchmark
const BENCHMARK = "^NSEI";


// ----------------------------------------------------
// NAVIGATION
// ----------------------------------------------------

document.querySelectorAll("nav button").forEach(button => {

  button.onclick = () => {

    document.querySelectorAll("nav button").forEach(x => {
      x.classList.toggle("active", x === button);
    });

    document.querySelectorAll(".view").forEach(view => {
      view.classList.toggle(
        "active",
        view.id === button.dataset.view
      );
    });

  };

});


// ----------------------------------------------------
// UTILITIES
// ----------------------------------------------------

function toast(text) {

  $("toast").textContent = text;

  $("toast").classList.add("show");

  setTimeout(() => {
    $("toast").classList.remove("show");
  }, 2400);

}


function save() {

  localStorage.setItem(
    "growfolio_data_v2",
    JSON.stringify(data)
  );

}


function mean(values) {

  if (!values.length) return 0;

  return (
    values.reduce((total, value) => total + value, 0) /
    values.length
  );

}


function stdev(values) {

  if (values.length < 2) return 0;

  const average = mean(values);

  const variance =
    values.reduce(
      (total, value) =>
        total + (value - average) ** 2,
      0
    ) /
    (values.length - 1);

  return Math.sqrt(variance);

}


// ----------------------------------------------------
// DAILY RETURNS
// ----------------------------------------------------

function returnMap(points) {

  const output = new Map();

  for (let i = 1; i < points.length; i++) {

    const previous = points[i - 1];
    const current = points[i];

    if (
      previous.price > 0 &&
      current.price > 0
    ) {

      output.set(
        current.date,
        current.price / previous.price - 1
      );

    }

  }

  return output;

}


// ----------------------------------------------------
// BETA VS NIFTY 50
// ----------------------------------------------------

function alignedBeta(stockPoints, marketPoints) {

  const stockReturns = returnMap(stockPoints);
  const marketReturns = returnMap(marketPoints);

  const stock = [];
  const market = [];

  // Match stock and NIFTY returns by trading date
  for (const [date, stockReturn] of stockReturns) {

    if (marketReturns.has(date)) {

      stock.push(stockReturn);
      market.push(marketReturns.get(date));

    }

  }

  // Not enough observations
  if (stock.length < 20) {
    return 0;
  }

  const stockMean = mean(stock);
  const marketMean = mean(market);

  let covariance = 0;
  let marketVariance = 0;

  for (let i = 0; i < stock.length; i++) {

    covariance +=
      (stock[i] - stockMean) *
      (market[i] - marketMean);

    marketVariance +=
      (market[i] - marketMean) ** 2;

  }

  if (!marketVariance) return 0;

  return covariance / marketVariance;

}


// ----------------------------------------------------
// 1 YEAR RETURN
// ----------------------------------------------------

function oneYearReturn(prices) {

  if (
    prices.length < 2 ||
    !prices[0]
  ) {
    return 0;
  }

  return (
    (prices.at(-1) / prices[0] - 1) *
    100
  );

}


// ----------------------------------------------------
// CAGR
// ----------------------------------------------------

function cagr(prices, days) {

  if (
    prices.length < 2 ||
    !prices[0] ||
    days <= 0
  ) {
    return 0;
  }

  const years = days / 365.25;

  return (
    (
      Math.pow(
        prices.at(-1) / prices[0],
        1 / years
      ) - 1
    ) * 100
  );

}


// ----------------------------------------------------
// MAXIMUM DRAWDOWN
// ----------------------------------------------------

function maxDrawdown(prices) {

  let peak = 0;
  let worst = 0;

  for (const price of prices) {

    if (price > peak) {
      peak = price;
    }

    if (peak > 0) {

      const drawdown =
        (price / peak - 1) * 100;

      worst = Math.min(
        worst,
        drawdown
      );

    }

  }

  return worst;

}


// ----------------------------------------------------
// RISK CLASSIFICATION
// ----------------------------------------------------

function riskLabel(stock) {

  if (
    !stock.stddev &&
    !stock.beta
  ) {
    return "—";
  }

  if (
    stock.beta >= 1.25 ||
    stock.stddev >= 35
  ) {
    return "High";
  }

  if (
    stock.beta <= 0.85 &&
    stock.stddev < 22
  ) {
    return "Low";
  }

  return "Moderate";

}


// ----------------------------------------------------
// GROWFOLIO SCORE
// ----------------------------------------------------

function grade(stock) {

  let score = 50;

  if (stock.beta) {

    if (stock.beta <= 1) {
      score += 8;
    }

    else if (stock.beta > 1.4) {
      score -= 8;
    }

  }

  if (stock.stddev) {

    if (stock.stddev < 20) {
      score += 10;
    }

    else if (stock.stddev > 35) {
      score -= 10;
    }

  }

  if (stock.changePct > 0) {
    score += 5;
  }

  score = Math.max(
    0,
    Math.min(
      100,
      Math.round(score)
    )
  );

  let letter;

  if (score >= 75) {
    letter = "A";
  }

  else if (score >= 65) {
    letter = "B";
  }

  else if (score >= 55) {
    letter = "C";
  }

  else if (score >= 45) {
    letter = "D";
  }

  else {
    letter = "E";
  }

  return {
    score,
    grade: letter
  };

}


// ----------------------------------------------------
// API
// ----------------------------------------------------

async function getJSON(url) {

  const response = await fetch(url);

  if (!response.ok) {
    throw new Error(
      "Market data request failed"
    );
  }

  return response.json();

}


// ----------------------------------------------------
// FIND COMPANY SYMBOL
// ----------------------------------------------------

async function resolveCompany(query) {

  const url =
    `${Y}/v1/finance/search` +
    `?q=${encodeURIComponent(query)}` +
    `&quotesCount=8&newsCount=0`;

  const json = await getJSON(url);

  const quotes =
    (json.quotes || []).filter(
      item =>
        item.quoteType === "EQUITY"
    );

  // Prefer NSE
  quotes.sort(
    (a, b) =>
      (b.exchange === "NSI") -
      (a.exchange === "NSI")
  );

  return quotes[0] || null;

}


// ----------------------------------------------------
// GET PRICE HISTORY
// ----------------------------------------------------

async function chart(
  symbol,
  range = "1y"
) {

  const url =
    `${Y}/v8/finance/chart/` +
    `${encodeURIComponent(symbol)}` +
    `?interval=1d&range=${range}`;

  const json = await getJSON(url);

  const result =
    json?.chart?.result?.[0];

  if (!result) {
    throw new Error(
      "No price history"
    );
  }

  const close =
    result.indicators
      ?.adjclose?.[0]
      ?.adjclose ||
    result.indicators
      ?.quote?.[0]
      ?.close ||
    [];

  const timestamps =
    result.timestamp || [];

  const points = [];

  for (
    let i = 0;
    i < Math.min(
      close.length,
      timestamps.length
    );
    i++
  ) {

    if (
      Number.isFinite(close[i])
    ) {

      points.push({

        date:
          new Date(
            timestamps[i] * 1000
          )
            .toISOString()
            .slice(0, 10),

        price: close[i]

      });

    }

  }

  return {

    meta: result.meta,

    points,

    prices:
      points.map(
        point => point.price
      )

  };

}


// ----------------------------------------------------
// CACHE NIFTY DATA
// ----------------------------------------------------

let benchmarkCache = null;


// ----------------------------------------------------
// ANALYSE STOCK
// ----------------------------------------------------

async function enrich(stock) {

  const resolved =
    stock.symbol
      ? {
          symbol: stock.symbol,
          longname: stock.company
        }
      : await resolveCompany(
          stock.company
        );

  if (!resolved) {

    throw new Error(
      `Could not find ${stock.company}`
    );

  }

  const symbol =
    resolved.symbol;


  // Download stock history
  const history =
    await chart(symbol);


  // Download NIFTY history
  const benchmark =
    benchmarkCache ||
    (
      benchmarkCache =
        await chart(BENCHMARK)
    );


  // Daily returns
  const dailyReturns =
    [
      ...returnMap(
        history.points
      ).values()
    ];


  // Latest price
  const last =
    Number(
      history.meta.regularMarketPrice ||
      history.prices.at(-1) ||
      0
    );


  // Previous price
  const previous =
    Number(
      history.meta.chartPreviousClose ||
      history.meta.previousClose ||
      history.prices.at(-2) ||
      last
    );


  // Number of days
  const days =
    history.points.length > 1
      ?
        (
          new Date(
            history.points.at(-1).date
          ) -
          new Date(
            history.points[0].date
          )
        ) /
        86400000
      :
        365;


  return {

    ...stock,

    symbol,

    company:
      resolved.longname ||
      resolved.shortname ||
      stock.company,

    exchange:
      resolved.exchange ||
      history.meta.exchangeName ||
      "",

    currency:
      history.meta.currency ||
      "INR",

    price: last,

    changePct:
      previous
        ?
          (
            (last - previous) /
            previous
          ) * 100
        :
          0,


    // Return
    return1y:
      oneYearReturn(
        history.prices
      ),


    // CAGR
    cagr:
      cagr(
        history.prices,
        days
      ),


    // Maximum Drawdown
    maxDrawdown:
      maxDrawdown(
        history.prices
      ),


    // Beta vs NIFTY
    beta:
      alignedBeta(
        history.points,
        benchmark.points
      ),


    // Annualized Standard Deviation
    stddev:
      stdev(
        dailyReturns
      ) *
      Math.sqrt(252) *
      100,


    updatedAt:
      Date.now()

  };

}


// ----------------------------------------------------
// RENDER PORTFOLIO
// ----------------------------------------------------

function render() {

  const calculated =
    data.map(stock => ({

      ...stock,

      ...grade(stock),

      risk:
        riskLabel(stock),

      value:
        stock.qty *
        stock.price

    }));


  const marketValue =
    calculated.reduce(
      (total, stock) =>
        total + stock.value,
      0
    );


  const averageScore =
    calculated.length
      ?
        Math.round(
          mean(
            calculated.map(
              stock =>
                stock.score
            )
          )
        )
      :
        0;


  // KPI
  $("invested").textContent =
    String(
      calculated.length
    );


  $("market").textContent =
    money(marketValue);


  $("pl").textContent =
    calculated.length
      ?
        mean(
          calculated.map(
            stock =>
              stock.beta || 0
          )
        ).toFixed(2)
      :
        "—";


  $("pl").className = "";


  $("plp").textContent =
    "portfolio avg beta";


  // Portfolio grade
  if (!calculated.length) {

    $("rating").textContent =
      "—";

  }

  else if (averageScore >= 75) {

    $("rating").textContent =
      "A";

  }

  else if (averageScore >= 65) {

    $("rating").textContent =
      "B";

  }

  else if (averageScore >= 55) {

    $("rating").textContent =
      "C";

  }

  else if (averageScore >= 45) {

    $("rating").textContent =
      "D";

  }

  else {

    $("rating").textContent =
      "E";

  }


  $("score").textContent =
    calculated.length
      ?
        `${averageScore}/100 risk view`
      :
        "No data";


  // --------------------------------------------------
  // ALLOCATION
  // --------------------------------------------------

  $("allocation").classList.toggle(
    "empty",
    !calculated.length
  );


  $("allocation").innerHTML =
    calculated.length
      ?
        [...calculated]
          .sort(
            (a, b) =>
              b.value - a.value
          )
          .map(stock => {

            const percentage =
              marketValue
                ?
                  (
                    stock.value /
                    marketValue
                  ) * 100
                :
                  0;

            return `
              <div class="barrow">

                <b>
                  ${esc(stock.symbol)}
                </b>

                <div class="track">
                  <i
                    style="width:${percentage}%"
                  ></i>
                </div>

                <span>
                  ${percentage.toFixed(1)}%
                </span>

              </div>
            `;

          }).join("")
      :
        "Add a company to see allocation.";


  // --------------------------------------------------
  // PROFILE
  // --------------------------------------------------

  const highRisk =
    calculated.filter(
      stock =>
        stock.risk === "High"
    ).length;


  $("profile").className =
    "profile";


  $("profile").innerHTML =
    calculated.length
      ?
        `

        <div class="line">

          <span>
            Holdings
          </span>

          <b>
            ${calculated.length}
          </b>

        </div>


        <div class="line">

          <span>
            High-risk positions
          </span>

          <b>
            ${highRisk}/${calculated.length}
          </b>

        </div>


        <div class="line">

          <span>
            Avg beta vs NIFTY 50
          </span>

          <b>
            ${
              mean(
                calculated.map(
                  stock =>
                    stock.beta || 0
                )
              ).toFixed(2)
            }
          </b>

        </div>


        <div class="line">

          <span>
            Avg annualized std. deviation
          </span>

          <b>
            ${
              mean(
                calculated.map(
                  stock =>
                    stock.stddev || 0
                )
              ).toFixed(1)
            }%
          </b>

        </div>

        `
      :
        "Risk characteristics will appear here.";


  // --------------------------------------------------
  // BUCKETS
  // --------------------------------------------------

  const buckets = [
    "High risk · High return",
    "Quality growth",
    "Stable / defensive",
    "Needs review"
  ];


  $("buckets").innerHTML =
    buckets.map(
      (bucket, index) => {

        const names =
          calculated
            .filter(stock => {

              if (index === 0) {
                return stock.risk === "High";
              }

              if (index === 2) {
                return stock.risk === "Low";
              }

              if (index === 3) {
                return stock.risk === "Moderate";
              }

              return false;

            })
            .map(
              stock =>
                `
                <span class="stockchip">
                  ${esc(stock.symbol)}
                </span>
                `
            )
            .join("");


        return `

          <div>

            <b>
              ${bucket}
            </b>

            <p class="stocklist">

              ${
                names ||
                '<span class="none">None</span>'
              }

            </p>

          </div>

        `;

      }
    ).join("");


  // --------------------------------------------------
  // RESEARCH VIEW
  // --------------------------------------------------

  $("recommendation").className =
    calculated.length
      ?
        "recommendation-body"
      :
        "recommendation-body empty";


  $("recommendation").innerHTML =
    calculated.length
      ?
        `

        <div>

          <b>
            Automatic market data
          </b>

          <p>
            Prices and one-year daily history
            are fetched for resolved exchange
            symbols.
          </p>

        </div>


        <div>

          <b>
            Risk model
          </b>

          <p>
            Beta is measured against NIFTY 50;
            standard deviation is annualized
            from daily returns.
          </p>

        </div>


        <div>

          <b>
            Return & CAGR
          </b>

          <p>
            One-year return and CAGR are
            calculated from the same adjusted
            price history used by the risk model.
          </p>

        </div>


        <div>

          <b>
            Maximum drawdown
          </b>

          <p>
            Shows the largest peak-to-trough
            decline observed in the downloaded
            one-year history.
          </p>

        </div>


        <div>

          <b>
            Cost basis
          </b>

          <p>
            Average purchase price cannot be
            inferred from public market data,
            so Growfolio does not fabricate
            invested value or P/L.
          </p>

        </div>

        `
      :
        "Add a company to generate portfolio observations.";


  // --------------------------------------------------
  // HOLDINGS TABLE
  // --------------------------------------------------

  $("rows").innerHTML =
    calculated.length
      ?
        calculated.map(stock => `

          <tr>

            <td>

              <span class="ticker">
                ${esc(stock.symbol)}
              </span>

              <span class="company">
                ${esc(stock.company)}
              </span>

            </td>


            <td>
              ${stock.qty}
            </td>


            <td>
              ${
                stock.price
                  ?
                    money(stock.price)
                  :
                    "—"
              }
            </td>


            <td>
              ${money(stock.value)}
            </td>


            <td>
              ${
                stock.beta
                  ?
                    stock.beta.toFixed(2)
                  :
                    "—"
              }
            </td>


            <td>
              ${
                stock.stddev
                  ?
                    stock.stddev.toFixed(1) + "%"
                  :
                    "—"
              }
            </td>


            <td>
              ${
                Number.isFinite(
                  stock.return1y
                )
                  ?
                    stock.return1y.toFixed(1) + "%"
                  :
                    "—"
              }
            </td>


            <td>
              ${
                Number.isFinite(
                  stock.cagr
                )
                  ?
                    stock.cagr.toFixed(1) + "%"
                  :
                    "—"
              }
            </td>


            <td>
              ${
                Number.isFinite(
                  stock.maxDrawdown
                )
                  ?
                    stock.maxDrawdown.toFixed(1) + "%"
                  :
                    "—"
              }
            </td>


            <td>

              <span class="pill">
                ${stock.risk}
              </span>

            </td>


            <td>

              <button
                class="remove"
                data-symbol="${esc(stock.symbol)}"
              >
                Remove
              </button>

            </td>

          </tr>

        `).join("")
      :
        `
        <tr>
          <td
            colspan="11"
            class="emptycell"
          >
            Add a company to begin.
          </td>
        </tr>
        `;


  // Remove buttons
  document
    .querySelectorAll(".remove")
    .forEach(button => {

      button.onclick = () => {

        data =
          data.filter(
            stock =>
              stock.symbol !==
              button.dataset.symbol
          );

        save();
        render();

      };

    });


  // --------------------------------------------------
  // RATING CARDS
  // --------------------------------------------------

  $("ratingcards").innerHTML =
    calculated.length
      ?
        calculated.map(stock => `

          <article class="card ratingcard">

            <div class="top">

              <div>

                <b>
                  ${esc(stock.symbol)}
                </b>

                <span class="company">
                  ${esc(stock.company)}
                </span>

              </div>

              <div class="grade">
                ${stock.grade}
              </div>

            </div>


            <div class="scorebar">
              <i
                style="width:${stock.score}%"
              ></i>
            </div>


            <div class="metrics">


              <div>
                <span>Latest price</span>
                <b>${money(stock.price)}</b>
              </div>


              <div>
                <span>Risk</span>
                <b>${stock.risk}</b>
              </div>


              <div>
                <span>Beta</span>

                <b>
                  ${
                    stock.beta
                      ?
                        stock.beta.toFixed(2)
                      :
                        "—"
                  }
                </b>
              </div>


              <div>
                <span>Std. deviation</span>

                <b>
                  ${
                    stock.stddev
                      ?
                        stock.stddev.toFixed(1) + "%"
                      :
                        "—"
                  }
                </b>
              </div>


              <div>
                <span>1Y return</span>

                <b>
                  ${
                    Number.isFinite(
                      stock.return1y
                    )
                      ?
                        stock.return1y.toFixed(1) + "%"
                      :
                        "—"
                  }
                </b>
              </div>


              <div>
                <span>CAGR</span>

                <b>
                  ${
                    Number.isFinite(
                      stock.cagr
                    )
                      ?
                        stock.cagr.toFixed(1) + "%"
                      :
                        "—"
                  }
                </b>
              </div>


              <div>
                <span>Max drawdown</span>

                <b>
                  ${
                    Number.isFinite(
                      stock.maxDrawdown
                    )
                      ?
                        stock.maxDrawdown.toFixed(1) + "%"
                      :
                        "—"
                  }
                </b>
              </div>


            </div>


            <p class="why">

              Risk statistics use approximately
              one year of daily market history.

              Beta benchmark: NIFTY 50.

            </p>

          </article>

        `).join("")
      :
        `
        <div class="card empty">
          Ratings appear after you add a company.
        </div>
        `;

}


// ----------------------------------------------------
// ADD COMPANY
// ----------------------------------------------------

async function addHolding(event) {

  event.preventDefault();


  const company =
    $("companyInput")
      .value
      .trim();


  const quantity =
    Number(
      $("qtyInput").value
    );


  if (
    !company ||
    !Number.isFinite(quantity) ||
    quantity <= 0
  ) {

    toast(
      "Enter a company and valid quantity"
    );

    return;

  }


  const button =
    $("addHolding");


  button.disabled = true;

  button.textContent =
    "Finding & analysing…";


  $("status").textContent =
    `Resolving ${company} and downloading market history…`;


  try {

    const stock =
      await enrich({

        company,

        qty: quantity

      });


    const existing =
      data.find(
        item =>
          item.symbol ===
          stock.symbol
      );


    if (existing) {

      Object.assign(
        existing,
        stock,
        {
          qty:
            existing.qty +
            quantity
        }
      );

    }

    else {

      data.push(stock);

    }


    save();

    render();


    $("companyInput").value =
      "";

    $("qtyInput").value =
      "";


    $("status").innerHTML =

      `Added <b>${esc(stock.company)}</b>
       (${esc(stock.symbol)}).
       Price, beta, return and risk
       statistics were calculated automatically.`;


    toast(
      `${stock.symbol} added`
    );

  }

  catch (error) {

    $("status").textContent =

      `Could not load market data:
       ${error.message}.
       Public browser endpoints may be
       blocked by CORS.`;


    toast(
      "Market data unavailable"
    );

  }

  finally {

    button.disabled = false;

    button.textContent =
      "Add holding";

  }

}


$("holdingForm")
  .addEventListener(
    "submit",
    addHolding
  );


// ----------------------------------------------------
// REFRESH ALL STOCKS
// ----------------------------------------------------

$("refresh").onclick =
  async () => {

    if (!data.length) {

      toast(
        "Add a holding first"
      );

      return;

    }


    $("refresh").disabled =
      true;


    $("refresh").textContent =
      "Refreshing…";


    benchmarkCache =
      null;


    let successful = 0;


    for (
      let i = 0;
      i < data.length;
      i++
    ) {

      try {

        data[i] =
          await enrich(
            data[i]
          );

        successful++;

      }

      catch (error) {

        console.error(
          error
        );

      }

    }


    save();

    render();


    $("refresh").disabled =
      false;


    $("refresh").textContent =
      "Refresh market data";


    $("status").innerHTML =

      `Refreshed
       <b>${successful}/${data.length}</b>
       holdings.`;


    toast(
      `${successful} holdings refreshed`
    );

  };


// ----------------------------------------------------
// LOAD SAVED PORTFOLIO
// ----------------------------------------------------

try {

  data =
    JSON.parse(
      localStorage.getItem(
        "growfolio_data_v2"
      ) || "[]"
    );

}

catch (error) {

  data = [];

}


render();


// ----------------------------------------------------
// PAYMENT
// ----------------------------------------------------

// Put your Razorpay / payment-page URL here.
const PAYMENT_LINK = "";


const payButton =
  $("pay99");


if (payButton) {

  payButton.onclick = () => {

    if (PAYMENT_LINK) {

      window.open(
        PAYMENT_LINK,
        "_blank",
        "noopener"
      );

    }

    else {

      toast(
        "Add your payment link in PAYMENT_LINK inside app.js"
      );

    }

  };

}
