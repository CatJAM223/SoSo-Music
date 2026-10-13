async function findWorkingKey() {
  try {
    const res = await fetch('https://soundcloud.com/discover', {
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' },
    });
    const html = await res.text();
    const scriptUrls = [
      ...html.matchAll(/src="(https:\/\/a-v2\.sndcdn\.com\/assets\/[^"]+\.js)"/g),
    ].map((m) => m[1]);
    console.log('Found JS files on SoundCloud:', scriptUrls.length);

    for (const url of scriptUrls.slice(-10)) {
      try {
        const jsRes = await fetch(url);
        const js = await jsRes.text();
        const matches = [...js.matchAll(/client_id[:=]"?([a-zA-Z0-9]{32})"?/gi)];
        for (const m of matches) {
          const key = m[1];
          const testRes = await fetch(
            `https://api-v2.soundcloud.com/search/tracks?q=test&client_id=${key}&limit=1`,
          );
          if (testRes.status === 200) {
            console.log('SUCCESS! WORKING SOUNDCLOUD CLIENT ID:', key);
            return key;
          }
        }
      } catch (e) {}
    }
  } catch (e) {
    console.error('Error finding key:', e);
  }
}

findWorkingKey();
