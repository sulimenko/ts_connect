({
  url: {
    protocol: 'https:/',
    live: 'api.',
    sim: 'sim-api.',
    domen: 'tradestation.com',
  },
  ptfin: {
    pkey: process.env.pkey,
    secret: process.env.secret,
    rtoken: process.env.rtoken,
  },
  // live: {
  // url: 'https://api.tradestation.com/v3',
  // url2: 'https://api.tradestation.com/v2/',
  // token: process.env.token,
  // account: process.env.account || '11827414',
  // },
  // sim: {
  // url: 'https://sim-api.tradestation.com/v3',
  // url2: 'https://sim-api.tradestation.com/v2/',
  // token: process.env.token,
  // account: '',
  // },
});
