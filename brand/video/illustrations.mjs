export function suiteIllustration(prefix='suite') {
 const id=n=>`${prefix}-${n}`;
 const days=Array.from({length:21},(_,i)=>`<rect x="${628+(i%7)*22}" y="${227+Math.floor(i/7)*26}" width="13" height="${i===9?15:5}" rx="2.5" fill="${i===9?'#0071e3':'#bed0e1'}"/>`).join('');
 return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1000 700" role="img" aria-label="Ilustración de correo, documentos y agenda conectados con Melodi">
 <defs>
 <linearGradient id="${id('paper')}" x2=".25" y2="1"><stop stop-color="#fff"/><stop offset="1" stop-color="#e6eef6"/></linearGradient>
 <linearGradient id="${id('blue')}" x2=".18" y2="1"><stop stop-color="#3a99f3"/><stop offset="1" stop-color="#0060c9"/></linearGradient>
 <linearGradient id="${id('fold')}" x2=".7" y2="1"><stop stop-color="#d5e9fd"/><stop offset="1" stop-color="#8bbdf0"/></linearGradient>
 <linearGradient id="${id('body')}" x1=".1" x2=".8" y2="1"><stop stop-color="#fff"/><stop offset=".55" stop-color="#f7fcf9"/><stop offset="1" stop-color="#d2e4dd"/></linearGradient>
 <radialGradient id="${id('ground')}"><stop stop-color="#8fb4d0" stop-opacity=".3"/><stop offset="1" stop-color="#bdd8ed" stop-opacity="0"/></radialGradient>
 <filter id="${id('shadow')}" x="-40%" y="-40%" width="180%" height="200%"><feDropShadow dx="0" dy="15" stdDeviation="14" flood-color="#254a69" flood-opacity=".16"/></filter>
 <filter id="${id('soft')}" x="-60%" y="-60%" width="220%" height="240%"><feDropShadow dx="0" dy="8" stdDeviation="7" flood-color="#294c67" flood-opacity=".14"/></filter>
 </defs>
 <ellipse cx="505" cy="574" rx="390" ry="93" fill="url(#${id('ground')})"/>
 <g class="routes" fill="none" stroke="#0071e3" stroke-width="3" stroke-linecap="round" opacity=".45"><path class="draw-route" d="M295 375C360 375 340 278 435 285"/><path class="draw-route" d="M645 245C572 238 622 330 558 343"/><path class="draw-route" d="M505 490C535 540 670 526 719 432"/></g>
 <g transform="translate(0 0)" class="art-folder"><g class="folder-float" filter="url(#${id('shadow')})">
 <path d="M145 326Q145 310 162 310H224L247 330H340Q357 330 358 350L347 488Q346 505 327 505H169Q150 505 149 488Z" fill="#a2cafa" stroke="#79afe9"/>
 <g transform="rotate(-8 237 383)"><rect x="175" y="277" width="126" height="162" rx="13" fill="url(#${id('paper')})" stroke="#d1dce7"/><path d="M195 304H242M195 320H277M195 336H266" fill="none" stroke="#b2c7da" stroke-width="5" stroke-linecap="round"/><path d="M195 375L216 354 237 377 257 360 278 383" fill="none" stroke="#6ba9e8" stroke-width="5" stroke-linecap="round" stroke-linejoin="round"/></g>
 <path d="M149 367Q148 352 165 352H353Q371 352 367 370L346 492Q344 507 326 507H166Q151 507 150 491Z" fill="url(#${id('blue')})" stroke="#0066cf"/><path d="M165 360H347" stroke="#94c9ff" stroke-width="2" opacity=".85"/><path d="M173 479H228" stroke="#c5e3ff" stroke-width="4" stroke-linecap="round" opacity=".7"/>
 </g></g>
 <g transform="rotate(7 713 225)" class="art-calendar"><g class="calendar-float" filter="url(#${id('shadow')})"><rect x="591" y="125" width="221" height="216" rx="23" fill="url(#${id('paper')})" stroke="#cbd9e6"/><path d="M615 126H789Q811 126 811 148V185H592V149Q592 126 615 126Z" fill="#0071e3"/><path d="M615 187H790" stroke="#bfd5eb"/><rect x="630" y="112" width="9" height="33" rx="4.5" fill="#b4c3d2" stroke="#e3ebf4"/><rect x="766" y="112" width="9" height="33" rx="4.5" fill="#b4c3d2" stroke="#e3ebf4"/><path d="M619 158H669" stroke="#c8e3ff" stroke-width="5" stroke-linecap="round"/><path d="M752 158H782" stroke="#c8e3ff" stroke-width="4" stroke-linecap="round"/>${days}<path d="M628 313H706" stroke="#a8c4df" stroke-width="5" stroke-linecap="round"/></g></g>
 <g class="art-envelope"><g class="mail-float" filter="url(#${id('shadow')})">
 <path d="M333 350L470 239Q492 221 515 239L652 350V506Q652 528 630 528H355Q333 528 333 506Z" fill="#9bc7f5" stroke="#82b6eb"/>
 <g class="letter"><rect x="372" y="238" width="241" height="248" rx="20" fill="url(#${id('paper')})" stroke="#cfdeed"/><rect x="394" y="264" width="39" height="39" rx="11" fill="#e0efff"/><path d="M403 282L411 290 425 275" fill="none" stroke="#0071e3" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/><path d="M452 274H582M452 291H543" stroke="#97aec3" stroke-width="6" stroke-linecap="round"/><path d="M397 326H583M397 346H567M397 366H579M397 386H528" stroke="#c2d1df" stroke-width="6" stroke-linecap="round"/><path d="M397 423H453" stroke="#0071e3" stroke-width="7" stroke-linecap="round"/></g>
 <path d="M333 350L488 443Q495 447 503 443L652 350V506Q652 528 630 528H355Q333 528 333 506Z" fill="url(#${id('fold')})" stroke="#8bb7e5"/>
 <path d="M333 507L460 412M652 507L526 412" fill="none" stroke="#b5d6f6" stroke-width="2"/><path d="M334 350L487 444Q495 449 503 444L651 350" fill="none" stroke="#e2f0ff" stroke-width="2"/>
 </g></g>
 <g transform="translate(680 348)" class="art-melodi"><g class="melodi-float" filter="url(#${id('soft')})"><ellipse cx="25" cy="64" rx="11" ry="17" fill="#e4f1ed"/><ellipse cx="162" cy="64" rx="11" ry="17" fill="#d8e7e0"/><path d="M39 39Q43 13 73 10Q100 7 125 16Q149 24 150 53L147 86Q143 107 117 111Q86 115 61 107Q37 101 35 79Z" fill="url(#${id('body')})" stroke="#dde9e4"/><path d="M51 34Q74 18 99 24" fill="none" stroke="#fff" stroke-width="7" stroke-linecap="round" opacity=".85"/><ellipse cx="71" cy="57" rx="4.8" ry="6.8" fill="#26382e"/><ellipse cx="115" cy="57" rx="4.8" ry="6.8" fill="#26382e"/><ellipse cx="59" cy="75" rx="9" ry="4.4" fill="#f3d7d0"/><ellipse cx="127" cy="75" rx="9" ry="4.4" fill="#f3d7d0"/><path d="M87 77Q93 82 99 77" fill="none" stroke="#afc0b6" stroke-width="2" stroke-linecap="round"/></g></g>
 </svg>`;
}

export function wordmark(path='assets/wordmark.svg') {return `<img class="brand-wordmark" src="${path}" alt="brivany.">`;}
