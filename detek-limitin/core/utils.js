const fs = require('fs');
const path = require('path');
const config = require('../config');
const logger = require('./logger');
let AdmZip = null; try { AdmZip = require('adm-zip'); } catch(e) {}

const getTodayDate = () => {
    return new Date().toLocaleDateString('id-ID', {
        timeZone: 'Asia/Jakarta',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit'
    }).split('/').reverse().join('-');
};

const getWaktuLengkap = () => {
    return new Date().toLocaleDateString('id-ID', {
        weekday: 'long',
        day: 'numeric', month: 'long', year: 'numeric',
        hour: '2-digit', minute: '2-digit',
        timeZone: 'Asia/Jakarta',
        timeZoneName: 'short'
    }).replace('pukul', ', Jam');
};

const formatWaktuGaul = (date = new Date()) => {
    const d = new Date(new Date(date).toLocaleString("en-US", { timeZone: "Asia/Jakarta" }));
    const days = ['Ahad', 'Senin', 'Selasa', 'Rabu', 'Kamis', 'Jumat', 'Sabtu'];
    const months = ['Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni', 'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember'];
    const dayName = days[d.getDay()];
    const dd = String(d.getDate()).padStart(2, '0');
    const monthName = months[d.getMonth()];
    const yyyy = d.getFullYear();
    const hh = String(d.getHours()).padStart(2, '0');
    const min = String(d.getMinutes()).padStart(2, '0');
    return `${dayName} ${dd} ${monthName} ${yyyy}, ${hh}:${min} WIB`;
};

function formatNomor(raw) {
    let clean = raw.replace(/[^0-9]/g, '');
    return '+' + clean;
}

function getCountryName(num) {
    if (!num) return '🏳️ Unknown';
    
    if (num.startsWith('1')) {
        const area = num.substring(1, 4);
        const ca = ['204', '226', '236', '249', '250', '289', '306', '343', '365', '403', '416', '418', '431', '438', '450', '506', '514', '519', '548', '579', '581', '587', '604', '613', '639', '647', '705', '709', '742', '778', '780', '807', '819', '825', '867', '873', '902', '905'];
        if (ca.includes(area)) return '<tg-emoji emoji-id="5292290347450259214">🇨🇦</tg-emoji> Canada';
        const nanpMap = {
            '242': '<tg-emoji emoji-id="5294031587321600012">🇧🇸</tg-emoji> Bahamas', '246': '<tg-emoji emoji-id="5294526187165471742">🇧🇧</tg-emoji> Barbados', '264': '<tg-emoji emoji-id="5292186323342350940">🇦🇮</tg-emoji> Anguilla', '268': '<tg-emoji emoji-id="5294005972136647964">🇦🇬</tg-emoji> Antigua and Barbuda',
            '284': '<tg-emoji emoji-id="5453884806880315764">🇻🇬</tg-emoji> British Virgin Islands', '345': '<tg-emoji emoji-id="5454177075109839093">🇰🇾</tg-emoji> Cayman Islands', '441': '<tg-emoji emoji-id="5913680005312811090">🇧🇲</tg-emoji> Bermuda', '473': '<tg-emoji emoji-id="5913228063084121946">🇬🇩</tg-emoji> Grenada',
            '649': '<tg-emoji emoji-id="5294320866253884749">🇹🇨</tg-emoji> Turks and Caicos', '664': '<tg-emoji emoji-id="5454038304716504375">🇲🇸</tg-emoji> Montserrat', '721': '<tg-emoji emoji-id="5461113820955027461">🇸🇽</tg-emoji> Sint Maarten', '758': '<tg-emoji emoji-id="5911243659344351824">🇱🇨</tg-emoji> Saint Lucia',
            '767': '<tg-emoji emoji-id="5294485513825178032">🇩🇲</tg-emoji> Dominica', '784': '<tg-emoji emoji-id="5911318941531116255">🇻🇨</tg-emoji> St. Vincent', '787': '<tg-emoji emoji-id="5292121516580820347">🇵🇷</tg-emoji> Puerto Rico', '809': '<tg-emoji emoji-id="5294522197140857947">🇩🇴</tg-emoji> Dominican Rep.',
            '829': '<tg-emoji emoji-id="5294522197140857947">🇩🇴</tg-emoji> Dominican Rep.', '849': '<tg-emoji emoji-id="5294522197140857947">🇩🇴</tg-emoji> Dominican Rep.', '868': '<tg-emoji emoji-id="5294362935458548705">🇹🇹</tg-emoji> Trinidad and Tobago', '869': '<tg-emoji emoji-id="5913691898077253637">🇰🇳</tg-emoji> St. Kitts',
            '876': '<tg-emoji emoji-id="5294505107465982830">🇯🇲</tg-emoji> Jamaica', '939': '<tg-emoji emoji-id="5292121516580820347">🇵🇷</tg-emoji> Puerto Rico'
        };
        if (nanpMap[area]) return nanpMap[area];
        return '<tg-emoji emoji-id="5294244076533600593">🇺🇸</tg-emoji> United States';
    }
    
    if (num.startsWith('7')) {
        const p = num.substring(1, 2);
        if (p === '6' || p === '7') return '<tg-emoji emoji-id="5294227175837290463">🇰🇿</tg-emoji> Kazakhstan';
        return '<tg-emoji emoji-id="5294335323113807278">🇷🇺</tg-emoji> Russia';
    }

    const p3 = num.substring(0, 3);
    const map3 = {
        '211':'<tg-emoji emoji-id="5911406262511211744">🇸🇸</tg-emoji> South Sudan','212':'<tg-emoji emoji-id="5292108962391414885">🇲🇦</tg-emoji> Morocco','213':'<tg-emoji emoji-id="5294048127240655242">🇩🇿</tg-emoji> Algeria','216':'<tg-emoji emoji-id="5294484680601521871">🇹🇳</tg-emoji> Tunisia','218':'<tg-emoji emoji-id="5291858711826946840">🇱🇾</tg-emoji> Libya',
        '220':'<tg-emoji emoji-id="5294399820637688352">🇬🇲</tg-emoji> Gambia','221':'<tg-emoji emoji-id="5292087023698466689">🇸🇳</tg-emoji> Senegal','222':'<tg-emoji emoji-id="5294429743674840973">🇲🇷</tg-emoji> Mauritania','223':'<tg-emoji emoji-id="5292086972158858331">🇲🇱</tg-emoji> Mali','224':'<tg-emoji emoji-id="5291892096607739008">🇬🇳</tg-emoji> Guinea',
        '225':'<tg-emoji emoji-id="5293991322003200135">🇨🇮</tg-emoji> Ivory Coast','226':'<tg-emoji emoji-id="5294153164960848949">🇧🇫</tg-emoji> Burkina Faso','227':'<tg-emoji emoji-id="5291809418487290691">🇳🇪</tg-emoji> Niger','228':'<tg-emoji emoji-id="5294097669688415562">🇹🇬</tg-emoji> Togo','229':'<tg-emoji emoji-id="5293984969746566866">🇧🇯</tg-emoji> Benin',
        '230':'<tg-emoji emoji-id="5294127824653797277">🇲🇺</tg-emoji> Mauritius','231':'<tg-emoji emoji-id="5291793810576137439">🇱🇷</tg-emoji> Liberia','232':'<tg-emoji emoji-id="5294494314213167952">🇸🇱</tg-emoji> Sierra Leone','233':'<tg-emoji emoji-id="5294347396266873249">🇬🇭</tg-emoji> Ghana','234':'<tg-emoji emoji-id="5294456308047563965">🇳🇬</tg-emoji> Nigeria',
        '235':'<tg-emoji emoji-id="5291780728105753403">🇹🇩</tg-emoji> Chad','236':'<tg-emoji emoji-id="5294210571493724819">🇨🇫</tg-emoji> Central African Rep.','237':'<tg-emoji emoji-id="5291997306126626950">🇨🇲</tg-emoji> Cameroon','238':'<tg-emoji emoji-id="5292203503211535593">🇨🇻</tg-emoji> Cape Verde',
        '239':'<tg-emoji emoji-id="5292183188016222701">🇸🇹</tg-emoji> Sao Tome','240':'<tg-emoji emoji-id="5292170045416297012">🇬🇶</tg-emoji> Equatorial Guinea','241':'<tg-emoji emoji-id="5294321325815389139">🇬🇦</tg-emoji> Gabon','242':'<tg-emoji emoji-id="5294035229453865597">🇨🇬</tg-emoji> Congo','243':'<tg-emoji emoji-id="5913770362834783827">🇨🇩</tg-emoji> DRC',
        '244':'<tg-emoji emoji-id="5294516785482062829">🇦🇴</tg-emoji> Angola','245':'<tg-emoji emoji-id="5294409819321550432">🇬🇼</tg-emoji> Guinea-Bissau','246':'<tg-emoji emoji-id="5454408067040952538">🇮🇴</tg-emoji> Diego Garcia','247':'🇦🇨 Ascension','248':'<tg-emoji emoji-id="5291891186074672309">🇸🇨</tg-emoji> Seychelles',
        '249':'<tg-emoji emoji-id="5294177148058228060">🇸🇩</tg-emoji> Sudan','250':'<tg-emoji emoji-id="5294191265615729158">🇷🇼</tg-emoji> Rwanda','251':'<tg-emoji emoji-id="5292245976143124155">🇪🇹</tg-emoji> Ethiopia','252':'<tg-emoji emoji-id="5294058817414255960">🇸🇴</tg-emoji> Somalia','253':'<tg-emoji emoji-id="5294127214768468283">🇩🇯</tg-emoji> Djibouti',
        '254':'<tg-emoji emoji-id="5292111852904416801">🇰🇪</tg-emoji> Kenya','255':'<tg-emoji emoji-id="5292146096678658977">🇹🇿</tg-emoji> Tanzania','256':'<tg-emoji emoji-id="5294192317882716626">🇺🇬</tg-emoji> Uganda','257':'<tg-emoji emoji-id="5294051631933967760">🇧🇮</tg-emoji> Burundi','258':'<tg-emoji emoji-id="5294086708931874940">🇲🇿</tg-emoji> Mozambique',
        '260':'<tg-emoji emoji-id="5294100109229838880">🇿🇲</tg-emoji> Zambia','261':'<tg-emoji emoji-id="5291991568050312348">🇲🇬</tg-emoji> Madagascar','262':'<tg-emoji emoji-id="5420322107068267129">🇷🇪</tg-emoji> Reunion','263':'<tg-emoji emoji-id="5294422158762592930">🇿🇼</tg-emoji> Zimbabwe','264':'<tg-emoji emoji-id="5292021761670404922">🇳🇦</tg-emoji> Namibia',
        '265':'<tg-emoji emoji-id="5294241881805312589">🇲🇼</tg-emoji> Malawi','266':'<tg-emoji emoji-id="5292040693886247604">🇱🇸</tg-emoji> Lesotho','267':'<tg-emoji emoji-id="5294026179957772585">🇧🇼</tg-emoji> Botswana','268':'<tg-emoji emoji-id="5294312482477724867">🇸🇿</tg-emoji> Eswatini','269':'<tg-emoji emoji-id="5294351381996521508">🇰🇲</tg-emoji> Comoros',
        '290':'<tg-emoji emoji-id="5454076894997659542">🇸🇭</tg-emoji> Saint Helena','291':'<tg-emoji emoji-id="5291922054004625949">🇪🇷</tg-emoji> Eritrea','297':'<tg-emoji emoji-id="5294007002928798927">🇦🇼</tg-emoji> Aruba','298':'<tg-emoji emoji-id="5228851794997688064">🇫🇴</tg-emoji> Faroe Islands','299':'<tg-emoji emoji-id="5292014752283774878">🇬🇱</tg-emoji> Greenland',
        '350':'<tg-emoji emoji-id="5292055799286224027">🇬🇮</tg-emoji> Gibraltar','351':'<tg-emoji emoji-id="5294436555492973610">🇵🇹</tg-emoji> Portugal','352':'<tg-emoji emoji-id="5294423709245787718">🇱🇺</tg-emoji> Luxembourg','353':'<tg-emoji emoji-id="5294471971793293647">🇮🇪</tg-emoji> Ireland','354':'<tg-emoji emoji-id="5294354358408859664">🇮🇸</tg-emoji> Iceland',
        '355':'<tg-emoji emoji-id="5294202819077756005">🇦🇱</tg-emoji> Albania','356':'<tg-emoji emoji-id="5294532213004588353">🇲🇹</tg-emoji> Malta','357':'<tg-emoji emoji-id="5294062721539526918">🇨🇾</tg-emoji> Cyprus','358':'<tg-emoji emoji-id="5294049961191690629">🇫🇮</tg-emoji> Finland','359':'<tg-emoji emoji-id="5294308947719640437">🇧🇬</tg-emoji> Bulgaria',
        '370':'<tg-emoji emoji-id="5294343084119708700">🇱🇹</tg-emoji> Lithuania','371':'<tg-emoji emoji-id="5292236016113966127">🇱🇻</tg-emoji> Latvia','372':'<tg-emoji emoji-id="5291951143818123103">🇪🇪</tg-emoji> Estonia','373':'<tg-emoji emoji-id="5294158486425325375">🇲🇩</tg-emoji> Moldova','374':'<tg-emoji emoji-id="5291978717508164018">🇦🇲</tg-emoji> Armenia',
        '375':'<tg-emoji emoji-id="5294134426018536120">🇧🇾</tg-emoji> Belarus','376':'<tg-emoji emoji-id="5294215205763434181">🇦🇩</tg-emoji> Andorra','377':'<tg-emoji emoji-id="5294378161117614233">🇲🇨</tg-emoji> Monaco','378':'<tg-emoji emoji-id="5292147350809106831">🇸🇲</tg-emoji> San Marino','379':'<tg-emoji emoji-id="5911211932420938860">🇻🇦</tg-emoji> Vatican',
        '380':'<tg-emoji emoji-id="5294263837678131580">🇺🇦</tg-emoji> Ukraine','381':'<tg-emoji emoji-id="5294458584380230360">🇷🇸</tg-emoji> Serbia','382':'<tg-emoji emoji-id="5913239436157522151">🇲🇪</tg-emoji> Montenegro','383':'<tg-emoji emoji-id="5911433681582429010">🇽🇰</tg-emoji> Kosovo','385':'<tg-emoji emoji-id="5291999676948569127">🇭🇷</tg-emoji> Croatia',
        '386':'<tg-emoji emoji-id="5294279359689938006">🇸🇮</tg-emoji> Slovenia','387':'<tg-emoji emoji-id="5913700002680541032">🇧🇦</tg-emoji> Bosnia','389':'<tg-emoji emoji-id="5294023611567332075">🇲🇰</tg-emoji> North Macedonia','420':'<tg-emoji emoji-id="5294242852467923382">🇨🇿</tg-emoji> Czechia','421':'<tg-emoji emoji-id="5294538440707166931">🇸🇰</tg-emoji> Slovakia',
        '423':'<tg-emoji emoji-id="5292048742654957785">🇱🇮</tg-emoji> Liechtenstein','500':'<tg-emoji emoji-id="5454214681843481342">🇫🇰</tg-emoji> Falkland Islands','501':'<tg-emoji emoji-id="5294171848068584842">🇧🇿</tg-emoji> Belize','502':'<tg-emoji emoji-id="5294336633078831209">🇬🇹</tg-emoji> Guatemala',
        '503':'<tg-emoji emoji-id="5294337307388695687">🇸🇻</tg-emoji> El Salvador','504':'<tg-emoji emoji-id="5291901034434682297">🇭🇳</tg-emoji> Honduras','505':'<tg-emoji emoji-id="5294240825243358100">🇳🇮</tg-emoji> Nicaragua','506':'<tg-emoji emoji-id="5292063805105263554">🇨🇷</tg-emoji> Costa Rica','507':'<tg-emoji emoji-id="5291959935616178405">🇵🇦</tg-emoji> Panama',
        '508':'<tg-emoji emoji-id="5231258308123313128">🇵🇲</tg-emoji> Saint Pierre','509':'<tg-emoji emoji-id="5292045130587462814">🇭🇹</tg-emoji> Haiti','590':'<tg-emoji emoji-id="5467664243081886165">🇬🇵</tg-emoji> Guadeloupe','591':'<tg-emoji emoji-id="5294201479047957700">🇧🇴</tg-emoji> Bolivia','592':'<tg-emoji emoji-id="5292062692708736193">🇬🇾</tg-emoji> Guyana',
        '593':'<tg-emoji emoji-id="5292083733753517221">🇪🇨</tg-emoji> Ecuador','594':'<tg-emoji emoji-id="5233523014313720667">🇬🇫</tg-emoji> French Guiana','595':'<tg-emoji emoji-id="5294525611639852679">🇵🇾</tg-emoji> Paraguay','596':'<tg-emoji emoji-id="5911378005921370347">🇲🇶</tg-emoji> Martinique','597':'<tg-emoji emoji-id="5294396668131692138">🇸🇷</tg-emoji> Suriname',
        '598':'<tg-emoji emoji-id="5291928449210932974">🇺🇾</tg-emoji> Uruguay','599':'<tg-emoji emoji-id="5233622988267472134">🇨🇼</tg-emoji> Curaçao','670':'<tg-emoji emoji-id="5911141915864076479">🇹🇱</tg-emoji> East Timor','672':'<tg-emoji emoji-id="5222477234601732139">🇦🇶</tg-emoji> Antarctica','673':'<tg-emoji emoji-id="5292098293692650297">🇧🇳</tg-emoji> Brunei',
        '674':'<tg-emoji emoji-id="5294463274484521342">🇳🇷</tg-emoji> Nauru','675':'<tg-emoji emoji-id="5291917995260533077">🇵🇬</tg-emoji> Papua New Guinea','676':'<tg-emoji emoji-id="5294283689016973348">🇹🇴</tg-emoji> Tonga','677':'<tg-emoji emoji-id="5294283890880433237">🇸🇧</tg-emoji> Solomon Islands','678':'<tg-emoji emoji-id="5294448585696368047">🇻🇺</tg-emoji> Vanuatu',
        '679':'<tg-emoji emoji-id="5911393832875856716">🇫🇯</tg-emoji> Fiji','680':'<tg-emoji emoji-id="5911283903187915549">🇵🇼</tg-emoji> Palau','681':'<tg-emoji emoji-id="5231000034559934302">🇼🇫</tg-emoji> Wallis','682':'<tg-emoji emoji-id="5292098684534675100">🇨🇰</tg-emoji> Cook Islands','683':'<tg-emoji emoji-id="5294471336138134209">🇳🇺</tg-emoji> Niue',
        '685':'<tg-emoji emoji-id="5913325971158602854">🇼🇸</tg-emoji> Samoa','686':'<tg-emoji emoji-id="5294538934628405146">🇰🇮</tg-emoji> Kiribati','687':'<tg-emoji emoji-id="5233223766762338378">🇳🇨</tg-emoji> New Caledonia','688':'<tg-emoji emoji-id="5454304115947487098">🇹🇻</tg-emoji> Tuvalu','689':'<tg-emoji emoji-id="5467450310760874001">🇵🇫</tg-emoji> French Polynesia',
        '690':'<tg-emoji emoji-id="5231066898610798438">🇹🇰</tg-emoji> Tokelau','691':'<tg-emoji emoji-id="5291838156113470124">🇫🇲</tg-emoji> Micronesia','692':'<tg-emoji emoji-id="5294180730060954484">🇲🇭</tg-emoji> Marshall Islands','850':'<tg-emoji emoji-id="5294193812531333564">🇰🇵</tg-emoji> North Korea',
        '852':'<tg-emoji emoji-id="5292166459118606932">🇭🇰</tg-emoji> Hong Kong','853':'<tg-emoji emoji-id="5420505321783179067">🇲🇴</tg-emoji> Macau','855':'<tg-emoji emoji-id="5294225191562400452">🇰🇭</tg-emoji> Cambodia','856':'<tg-emoji emoji-id="5291981530711746037">🇱🇦</tg-emoji> Laos','880':'<tg-emoji emoji-id="5291824687096027834">🇧🇩</tg-emoji> Bangladesh',
        '886':'<tg-emoji emoji-id="5294095745543069603">🇹🇼</tg-emoji> Taiwan','960':'<tg-emoji emoji-id="5292004203844097218">🇲🇻</tg-emoji> Maldives','961':'<tg-emoji emoji-id="5294193108156699621">🇱🇧</tg-emoji> Lebanon','962':'<tg-emoji emoji-id="5291988613112814801">🇯🇴</tg-emoji> Jordan','963':'<tg-emoji emoji-id="5294013428199869487">🇸🇾</tg-emoji> Syria',
        '964':'<tg-emoji emoji-id="5294325010897327367">🇮🇶</tg-emoji> Iraq','965':'<tg-emoji emoji-id="5292066437920218075">🇰🇼</tg-emoji> Kuwait','966':'<tg-emoji emoji-id="5294163983983463099">🇸🇦</tg-emoji> Saudi Arabia','967':'<tg-emoji emoji-id="5294058972033076492">🇾🇪</tg-emoji> Yemen','968':'<tg-emoji emoji-id="5291813666209946812">🇴🇲</tg-emoji> Oman',
        '970':'<tg-emoji emoji-id="5294289826525238172">🇵🇸</tg-emoji> Palestine','971':'<tg-emoji emoji-id="5294314831824835370">🇦🇪</tg-emoji> UAE','972':'<tg-emoji emoji-id="5294069056616289553">🇮🇱</tg-emoji> Israel','973':'<tg-emoji emoji-id="5294108398516720753">🇧🇭</tg-emoji> Bahrain','974':'<tg-emoji emoji-id="5292166360334357676">🇶🇦</tg-emoji> Qatar',
        '975':'<tg-emoji emoji-id="5294121983498277263">🇧🇹</tg-emoji> Bhutan','976':'<tg-emoji emoji-id="5294316532631883496">🇲🇳</tg-emoji> Mongolia','977':'<tg-emoji emoji-id="5294458756178924088">🇳🇵</tg-emoji> Nepal','992':'<tg-emoji emoji-id="5294120269806328883">🇹🇯</tg-emoji> Tajikistan','993':'<tg-emoji emoji-id="5294098958178603764">🇹🇲</tg-emoji> Turkmenistan',
        '994':'<tg-emoji emoji-id="5294323533428579078">🇦🇿</tg-emoji> Azerbaijan','995':'<tg-emoji emoji-id="5294349389131697267">🇬🇪</tg-emoji> Georgia','996':'<tg-emoji emoji-id="5292091954320922577">🇰🇬</tg-emoji> Kyrgyzstan','998':'<tg-emoji emoji-id="5294217645304864345">🇺🇿</tg-emoji> Uzbekistan'
    };
    if (map3[p3]) return map3[p3];

    const p2 = num.substring(0, 2);
    const map2 = {
        '20':'<tg-emoji emoji-id="5293992082212409502">🇪🇬</tg-emoji> Egypt','27':'<tg-emoji emoji-id="5294325281480266304">🇿🇦</tg-emoji> South Africa','30':'<tg-emoji emoji-id="5291948395039054764">🇬🇷</tg-emoji> Greece','31':'<tg-emoji emoji-id="5291917797692042265">🇳🇱</tg-emoji> Netherlands','32':'<tg-emoji emoji-id="5291774466043435275">🇧🇪</tg-emoji> Belgium',
        '33':'<tg-emoji emoji-id="5291817660529533837">🇫🇷</tg-emoji> France','34':'<tg-emoji emoji-id="5294513087515216901">🇪🇸</tg-emoji> Spain','36':'<tg-emoji emoji-id="5294229581018975260">🇭🇺</tg-emoji> Hungary','39':'<tg-emoji emoji-id="5291826830284709120">🇮🇹</tg-emoji> Italy','40':'<tg-emoji emoji-id="5294107724206856227">🇷🇴</tg-emoji> Romania','41':'<tg-emoji emoji-id="5291791748991835084">🇨🇭</tg-emoji> Switzerland',
        '43':'<tg-emoji emoji-id="5291975174160145850">🇦🇹</tg-emoji> Austria','44':'<tg-emoji emoji-id="5293993521026453119">🇬🇧</tg-emoji> United Kingdom','45':'<tg-emoji emoji-id="5294531860817268837">🇩🇰</tg-emoji> Denmark','46':'<tg-emoji emoji-id="5291737091238026321">🇸🇪</tg-emoji> Sweden','47':'<tg-emoji emoji-id="5291761718580502030">🇳🇴</tg-emoji> Norway',
        '48':'<tg-emoji emoji-id="5292190970496963836">🇵🇱</tg-emoji> Poland','49':'<tg-emoji emoji-id="5292013274815028523">🇩🇪</tg-emoji> Germany','51':'<tg-emoji emoji-id="5292099427564018941">🇵🇪</tg-emoji> Peru','52':'<tg-emoji emoji-id="5294535073452809778">🇲🇽</tg-emoji> Mexico','53':'<tg-emoji emoji-id="5291963947115631526">🇨🇺</tg-emoji> Cuba','54':'<tg-emoji emoji-id="5292208210495689627">🇦🇷</tg-emoji> Argentina',
        '55':'<tg-emoji emoji-id="5291892229751723900">🇧🇷</tg-emoji> Brazil','56':'<tg-emoji emoji-id="5294231037012888049">🇨🇱</tg-emoji> Chile','57':'<tg-emoji emoji-id="5294010206974397371">🇨🇴</tg-emoji> Colombia','58':'<tg-emoji emoji-id="5294476442854247878">🇻🇪</tg-emoji> Venezuela','60':'<tg-emoji emoji-id="5291858351049696702">🇲🇾</tg-emoji> Malaysia',
        '61':'<tg-emoji emoji-id="5294444247779399477">🇦🇺</tg-emoji> Australia','62':'<tg-emoji emoji-id="5294378161117614233">🇮🇩</tg-emoji> Indonesia','63':'<tg-emoji emoji-id="5291798075478661634">🇵🇭</tg-emoji> Philippines','64':'<tg-emoji emoji-id="5294189019347833274">🇳🇿</tg-emoji> New Zealand','65':'<tg-emoji emoji-id="5294451304410663668">🇸🇬</tg-emoji> Singapore',
        '66':'<tg-emoji emoji-id="5293994384314882755">🇹🇭</tg-emoji> Thailand','81':'<tg-emoji emoji-id="5291799063321139445">🇯🇵</tg-emoji> Japan','82':'<tg-emoji emoji-id="5294408281723262763">🇰🇷</tg-emoji> South Korea','84':'<tg-emoji emoji-id="5294235963340379688">🇻🇳</tg-emoji> Vietnam','86':'<tg-emoji emoji-id="5294068833277990704">🇨🇳</tg-emoji> China',
        '90':'<tg-emoji emoji-id="5293993400767367408">🇹🇷</tg-emoji> Turkey','91':'<tg-emoji emoji-id="5291933173674957761">🇮🇳</tg-emoji> India','92':'<tg-emoji emoji-id="5291825606219029010">🇵🇰</tg-emoji> Pakistan','93':'<tg-emoji emoji-id="5291937511591925566">🇦🇫</tg-emoji> Afghanistan','94':'<tg-emoji emoji-id="5292102670264328257">🇱🇰</tg-emoji> Sri Lanka',
        '95':'<tg-emoji emoji-id="5294254478944393569">🇲🇲</tg-emoji> Myanmar','98':'<tg-emoji emoji-id="5294220170745630736">🇮🇷</tg-emoji> Iran'
    };
    if (map2[p2]) return map2[p2];

    return '🏳️ Unknown';
}

const joinCache = new Map();
const JOIN_CACHE_TTL = 5 * 60 * 1000;

function clearJoinCache(userId = null) {
    if (userId) {
        joinCache.delete(`fsub_${userId}`);
    } else {
        joinCache.clear();
    }
}

async function isJoined(ctx, forceRefresh = false) {
    if (!ctx || !ctx.from) return { allJoined: false, unjoined: [] };
    const userId = String(ctx.from.id);
    if (userId === String(config.ownerId)) return { allJoined: true, unjoined: [] };

    if (global.IS_FORCE_SUB_ENABLED === false) {
        return { allJoined: true, unjoined: [] };
    }

    const channelList = (Array.isArray(global.forceSubChannels) && global.forceSubChannels.length > 0)
        ? global.forceSubChannels
        : (Array.isArray(config.forceSub) ? config.forceSub : []);

    if (!channelList || channelList.length === 0) {
        return { allJoined: true, unjoined: [] };
    }

    const now = Date.now();
    const cacheKey = `fsub_${userId}`;
    if (!forceRefresh && joinCache.has(cacheKey)) {
        const cached = joinCache.get(cacheKey);
        const ttl = cached.allJoined ? JOIN_CACHE_TTL : 2000;
        if (now - cached.time < ttl) {
            return cached;
        }
    }

    const unjoined = [];
    const promises = channelList.map(async (rawChat) => {
        let chat;
        if (typeof rawChat === 'object' && rawChat !== null) {
            chat = { ...rawChat };
        } else {
            const s = String(rawChat).trim();
            chat = {
                id: s,
                title: s.startsWith('@') ? s.slice(1) : s,
                username: s.startsWith('@') ? s : ''
            };
        }

        const targetId = chat.id || chat.username || chat.chatId;
        if (!targetId) return;

        try {
            const chatMember = await ctx.telegram.getChatMember(targetId, ctx.from.id);
            const isMember = ['creator', 'administrator', 'member', 'restricted'].includes(chatMember.status);
            if (!isMember) {
                unjoined.push(chat);
            }
        } catch (e) {
            unjoined.push(chat);
            logger.add('DEBUG', `isJoined check failed for user ${userId} in chat ${targetId}: ${e.message}`);
        }
    });

    await Promise.all(promises);

    const result = {
        allJoined: unjoined.length === 0,
        unjoined: unjoined,
        time: now
    };

    joinCache.set(cacheKey, result);
    return result;
}

async function createProjectBackup(baseDir = path.join(__dirname, '..')) {
    if (!AdmZip) {
        throw new Error('Modul adm-zip tidak tersedia');
    }

    const ignoredDirs = new Set([
        'node_modules',
        'wa_sessions',
        '.git',
        '.github',
        '.gitlab',
        'tmp',
        'temp',
        '.tmp',
        '.temp',
        '.cache',
        '.npm',
        '.system_generated',
        '.gemini',
        'brain',
        '.vscode',
        '.idea',
        'scratch',
        '.pnpm-store'
    ]);

    const ignoredFileExts = new Set(['.log', '.zip', '.tar', '.gz', '.rar', '.7z', '.bak']);
    const ignoredFileNames = new Set(['.DS_Store', 'Thumbs.db', 'crash.log', 'latest.log', 'npm-debug.log', 'yarn-debug.log', 'yarn-error.log']);

    function scanDir(dir) {
        let results = [];
        if (!fs.existsSync(dir)) return results;
        const entries = fs.readdirSync(dir, { withFileTypes: true });
        for (const entry of entries) {
            const fullPath = path.join(dir, entry.name);
            if (entry.isDirectory()) {
                if (ignoredDirs.has(entry.name)) continue;
                results = results.concat(scanDir(fullPath));
            } else if (entry.isFile()) {
                if (ignoredFileNames.has(entry.name)) continue;
                const ext = path.extname(entry.name).toLowerCase();
                if (ignoredFileExts.has(ext)) continue;
                const relPath = path.relative(baseDir, fullPath);
                results.push({ fullPath, relPath });
            }
        }
        return results;
    }

    const files = scanDir(baseDir);
    const zip = new AdmZip();

    for (const file of files) {
        const zipDir = path.dirname(file.relPath);
        zip.addLocalFile(file.fullPath, zipDir === '.' ? '' : zipDir);
    }

    const buffer = zip.toBuffer();
    const sizeInMB = (buffer.length / (1024 * 1024)).toFixed(2);
    const sizeInKB = (buffer.length / 1024).toFixed(2);
    const formattedSize = buffer.length >= 1024 * 1024 ? `${sizeInMB} MB` : `${sizeInKB} KB`;

    const now = new Date(new Date().toLocaleString("en-US", { timeZone: "Asia/Jakarta" }));
    const yyyy = now.getFullYear();
    const mm = String(now.getMonth() + 1).padStart(2, '0');
    const dd = String(now.getDate()).padStart(2, '0');
    const hh = String(now.getHours()).padStart(2, '0');
    const min = String(now.getMinutes()).padStart(2, '0');
    const ss = String(now.getSeconds()).padStart(2, '0');
    const fileName = `backup-project-${yyyy}${mm}${dd}_${hh}${min}${ss}.zip`;

    return {
        buffer,
        fileName,
        fileCount: files.length,
        fileSize: formattedSize,
        fileSizeBytes: buffer.length
    };
}

module.exports = {
    getTodayDate,
    getWaktuLengkap,
    formatWaktuGaul,
    formatNomor,
    getCountryName,
    isJoined,
    clearJoinCache,
    createProjectBackup
};
