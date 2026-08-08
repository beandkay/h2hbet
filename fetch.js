const fs = require('fs');
const fetchSite = async () => {
  const res = await fetch('https://h2h.cdn-hudstats.com/assets/index-BfTNW5st.js');
  const text = await res.text();
  fs.writeFileSync('bundle.js', text);
};
fetchSite();
