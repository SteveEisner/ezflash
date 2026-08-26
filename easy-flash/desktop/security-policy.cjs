const APP_ORIGIN="wledtubes://easy-flash",APP_ENTRY=`${APP_ORIGIN}/index.html`;
const CSP=["default-src 'self'","script-src 'self'","style-src 'self'","img-src 'self' data:","connect-src 'self'","object-src 'none'","base-uri 'none'","form-action 'none'","frame-ancestors 'none'"].join("; ");
function normalizeAppPath(value){if(typeof value!=="string"||/%(?:2e|2f|5c)/i.test(value)||/\/\.\.(?:\/|$)/.test(value))return null;let url;try{url=new URL(value);}catch{return null;}if(url.protocol!=="wledtubes:"||url.hostname!=="easy-flash"||url.username||url.password||url.port||url.search||url.hash)return null;let pathname;try{pathname=decodeURIComponent(url.pathname);}catch{return null;}if(pathname==="/")pathname="/index.html";if(pathname.includes("\\")||pathname.split("/").some(part=>part===".."||part==="."))return null;return pathname;}
const isAllowedNavigation=value=>normalizeAppPath(value)==="/index.html";
const isAppOrigin=value=>{try{const url=new URL(value);return url.protocol==="wledtubes:"&&url.hostname==="easy-flash"&&!url.username&&!url.password&&!url.port;}catch{return false;}};
module.exports={APP_ENTRY,APP_ORIGIN,CSP,isAllowedNavigation,isAppOrigin,normalizeAppPath};
