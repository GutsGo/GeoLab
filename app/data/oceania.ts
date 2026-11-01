import type { Country } from './types'

export const oceania: Country[] = [
  {
    id: '36',
    code: 'au',
    name: '澳大利亚',
    nameEn: 'Australia',
    capital: '堪培拉',
    continent: '大洋洲',
    subregion: '澳新',
    flag: '🇦🇺',
    tagline: '一块大陆当一个国家，内陆是红的，海岸是绿的',
    population: '约 2700 万',
    area: '约 769 万 km²',
    language: '英语（无官方语言）',
    currency: '澳元 A$',
    ethnic: [{ name: '欧洲裔', pct: 54 }, { name: '亚裔', pct: 17 }, { name: '原住民与托雷斯海峡岛民', pct: 3.2 }, { name: '其他', pct: 25.8 }],
    intro:
      '全球最小的洲、最大的岛，也是最平坦、最干燥的有人居住大陆，中部是红色沙漠，边缘才是宜居带。',
    history:
      '原住民在此生活了至少 6.5 万年，是世界上最古老连续的文化之一。1770 年库克船长宣称东海岸为英国所有，1788 年开始流放殖民地。19 世纪淘金潮带来大量移民，1901 年六个殖民地组成联邦。二战后"白澳政策"逐步废除，亚洲移民改变了人口结构。',
    culture:
      '海滩、烧烤、板球与"fair go"（公平机会）构成国民想象。原住民艺术（点画、树皮画）是全球最古老的持续艺术传统之一。国民性格里有一种对权威的轻慢，以及对危险的幽默化处理。',
    landmarks: [
      { name: '乌鲁鲁', desc: '艾尔斯岩，原住民阿南古人的圣地，日落时变红。' },
      { name: '大堡礁', desc: '2300 公里长的珊瑚礁系统，可潜水或直升机俯瞰。' },
      { name: '悉尼歌剧院', desc: '壳形屋顶，20 世纪最具辨识度的建筑之一。' },
      { name: '大洋路', desc: '海岸公路与十二门徒岩，石灰岩被海浪掏空。' },
    ],
    foods: [
      { name: 'Vegemite', desc: '酵母提取物抹酱，外国人普遍接受不了。' },
      { name: '肉派', desc: '酥皮包肉馅，体育场标配。' },
      { name: 'Barramundi', desc: '澳洲肺鱼，煎烤皆宜。' },
    ],
    funFact: '澳大利亚是唯一一个既是国家又是大陆的政治实体，也是全球最平坦的大陆。',
    cities: [
      { name: '堪培拉', lat: -35.28, lng: 149.13, capital: true },
      { name: '悉尼', lat: -33.87, lng: 151.21 },
      { name: '墨尔本', lat: -37.81, lng: 144.96 },
      { name: '乌鲁鲁', lat: -25.34, lng: 131.04 },
    ],
  },
  {
    id: '554',
    code: 'nz',
    name: '新西兰',
    nameEn: 'New Zealand',
    capital: '惠灵顿',
    continent: '大洋洲',
    subregion: '澳新',
    flag: '🇳🇿',
    tagline: '两块主岛、一条火山带，羊比人多五倍',
    population: '约 520 万',
    area: '约 26.8 万 km²',
    language: '英语、毛利语、新西兰手语',
    currency: '新西兰元 NZ$',
    ethnic: [{ name: '欧裔', pct: 67 }, { name: '毛利裔', pct: 17.8 }, { name: '亚裔', pct: 17 }, { name: '太平洋岛民', pct: 8.9 }],
    intro:
      '南太平洋的岛国，南岛是冰川与峡湾，北岛是火山与地热，两地气质完全不同。',
    history:
      '毛利人约在 13 世纪乘独木舟抵达，1840 年与英国签订《怀唐伊条约》，此后因土地战争与条约解释争议不断。1907 年成为自治领，1947 年完全独立。1980 年代无核政策让它与美国关系紧张，近年条约赔偿与毛利语复兴是重要议题。',
    culture:
      '毛利战舞（haka）已成为国家仪式的一部分，体育队伍赛前必跳。咖啡馆文化密度极高，flat white 据说是这里发明的。对户外运动（徒步、橄榄球、帆船）的投入近乎国民义务。',
    landmarks: [
      { name: '米尔福德峡湾', desc: '冰川切出的峡湾，瀑布直接从崖壁落入海中。' },
      { name: '罗托鲁瓦', desc: '地热区，间歇泉与泥浆池，空气中都是硫味。' },
      { name: '库克山', desc: '3724 米，新西兰最高峰，徒步线路环绕冰川湖。' },
    ],
    foods: [
      { name: 'Hangi', desc: '地坑石烤，肉与蔬菜用热石焖熟。' },
      { name: '绿唇贻贝', desc: '养殖产量大，蒜蓉白葡萄酒煮最普遍。' },
      { name: 'Pavlova', desc: '蛋白霜蛋糕，与澳大利亚争了几十年发明权。' },
    ],
    funFact: '新西兰是第一个给予女性选举权的自治国家（1893 年）。',
    cities: [
      { name: '惠灵顿', lat: -41.29, lng: 174.78, capital: true },
      { name: '奥克兰', lat: -36.85, lng: 174.76 },
      { name: '皇后镇', lat: -45.03, lng: 168.66 },
    ],
  },
  {
    id: '598',
    code: 'pg',
    name: '巴布亚新几内亚',
    nameEn: 'Papua New Guinea',
    capital: '莫尔斯比港',
    continent: '大洋洲',
    subregion: '美拉尼西亚',
    flag: '🇵🇬',
    tagline: '八百多种语言，全球语言密度最高的地方',
    population: '约 1000 万',
    area: '约 46.3 万 km²',
    language: '英语、托克皮辛语、希里莫图语（及 800 余种语言）',
    currency: '基那 K',
    ethnic: [{ name: '美拉尼西亚人', pct: 95 }, { name: '其他太平洋岛民及亚裔', pct: 5 }],
    intro:
      '新几内亚岛东半部与周边群岛，中央高地山脉横贯，沿海是沼泽与珊瑚礁，内陆许多地方只能靠小飞机进入。',
    history:
      '原住民在此耕作至少七千年，是全球最早的农业发源地之一。1884 年被德国与英国瓜分，一战後由澳大利亚管理，1975 年独立。布干维尔内战持续到 1990 年代末。资源（金、铜、天然气）丰富但基础设施薄弱。',
    culture:
      '800 多种语言意味着每隔几十公里就换一种语言。高地地区的贝壳货币、部落战争与"sing-sing"集会（歌舞节）是文化标志。',
    landmarks: [
      { name: '科科达小径', desc: '二战太平洋战场的徒步路线，穿越欧文斯坦利山脉。' },
      { name: '拉包尔', desc: '火山口环绕的港口城市，1994 年喷发埋掉大半。' },
      { name: '塞皮克河', desc: '全长 1126 公里，沿岸村落以鳄鱼图腾木雕闻名。' },
    ],
    foods: [
      { name: 'Mumu', desc: '热石焖烤猪肉、红薯与香蕉。' },
      { name: 'Sago', desc: '西米淀粉，低地地区的主食。' },
    ],
    funFact: '巴布亚新几内亚有超过 800 种活语言，占全球语言总数的约十分之一。',
    cities: [
      { name: '莫尔斯比港', lat: -9.44, lng: 147.18, capital: true },
      { name: '莱城', lat: -6.73, lng: 147.0 },
    ],
  },
  {
    id: '242',
    code: 'fj',
    name: '斐济',
    nameEn: 'Fiji',
    capital: '苏瓦',
    continent: '大洋洲',
    subregion: '美拉尼西亚',
    flag: '🇫🇯',
    tagline: '三百多座岛，国际日期变更线从这里拐了个弯',
    population: '约 93 万',
    area: '约 1.83 万 km²',
    language: '英语、斐济语、斐济印地语',
    currency: '斐济元 FJ$',
    ethnic: [{ name: '斐济族（iTaukei）', pct: 56 }, { name: '印度裔', pct: 37 }, { name: '其他', pct: 7 }],
    intro:
      '南太平洋中心的群岛国家，维提岛与瓦努阿岛是主要陆地，珊瑚礁环绕，是潜水与度假目的地。',
    history:
      '美拉尼西亚与波利尼西亚文化在此交汇。1874 年成为英国殖民地，殖民者为种甘蔗引入大量印度契约劳工，形成今日的族群结构。1970 年独立，此后发生四次政变，族群政治与土地权是核心冲突。',
    culture:
      '卡瓦（kava）仪式是社交与政治场合的标准流程。Meke 歌舞与走火仪式（vilavilairevo）是旅游表演，也有真实的仪式背景。橄榄球是国民运动。',
    landmarks: [
      { name: '玛玛努卡群岛', desc: '小岛群，白沙滩与浮潜能见度极高。' },
      { name: '塔韦乌尼岛', desc: '国际日期变更线穿过，被称为"世界日出第一缕"。' },
      { name: '辛加托卡沙丘', desc: '内陆沙丘国家公园，与海岸雨林形成对比。' },
    ],
    foods: [
      { name: 'Kokoda', desc: '椰奶腌制的生鱼，配青柠与辣椒。' },
      { name: 'Lovo', desc: '地坑石烤，类似斐济版 Hangi。' },
    ],
    funFact: '斐济由 333 座岛屿组成，其中约 110 座有人居住。',
    cities: [
      { name: '苏瓦', lat: -18.14, lng: 178.44, capital: true },
      { name: '楠迪', lat: -17.75, lng: 177.44 },
    ],
  },
  {
    id: '882',
    code: 'ws',
    name: '萨摩亚',
    nameEn: 'Samoa',
    capital: '阿皮亚',
    continent: '大洋洲',
    subregion: '波利尼西亚',
    flag: '🇼🇸',
    tagline: '波利尼西亚的腹地，全村人睡在没有墙的房子里',
    population: '约 22 万',
    area: '约 2842 km²',
    language: '萨摩亚语、英语',
    currency: '塔拉 T',
    ethnic: [{ name: '萨摩亚人', pct: 96 }, { name: '混血及其他', pct: 4 }],
    intro:
      '南太平洋的火山岛国，两座主岛与几座小岛，内陆是雨林与火山锥，海岸是珊瑚礁。',
    history:
      '萨摩亚是波利尼西亚文化的重要中心，传统社会结构以家族（aiga）与村级议事（fono）为基础。19 世纪英美德三国争夺，1899 年西萨摩亚归德国，一战后由新西兰管理，1962 年成为太平洋第一个独立的国家。',
    culture:
      '法雷（fale）是没有墙的开放式房屋，挂下椰叶帘子就是「关门」。Fa’a Samoa（萨摩亚方式）强调家族、尊重与互惠。传统纹身（tatau）对男性（Pe’a）与女性（Malu）有不同图案。',
    landmarks: [
      { name: 'To Sua 天坑', desc: '30 米深的天然海水池，靠木梯下去。' },
      { name: '拉洛马努海滩', desc: '白沙与椰林，退潮时可以走到礁盘外。' },
      { name: '萨瓦伊岛', desc: '火山地貌与喷水洞，游客密度远低于主岛。' },
    ],
    foods: [
      { name: 'Oka', desc: '椰奶腌生鱼，配青柠与洋葱。' },
      { name: 'Umu', desc: '热石焖烤的传统做法，周日家庭聚餐必备。' },
    ],
    funFact: '萨摩亚在 2011 年跳过了 12 月 30 日，从日期变更线东侧移到西侧，以对齐澳新市场。',
    cities: [
      { name: '阿皮亚', lat: -13.83, lng: -171.77, capital: true },
      { name: '萨勒奥洛加', lat: -13.62, lng: -172.65 },
    ],
  },
  {
    id: '548',
    code: 'vu',
    name: '瓦努阿图',
    nameEn: 'Vanuatu',
    capital: '维拉港',
    continent: '大洋洲',
    subregion: '美拉尼西亚',
    flag: '🇻🇺',
    tagline: '八十多座岛，一座活火山天天在喷',
    population: '约 33 万',
    area: '约 1.22 万 km²',
    language: '比斯拉马语、英语、法语（及 100 余种本地语言）',
    currency: '瓦图 VT',
    ethnic: [{ name: '美拉尼西亚人（Ni-Vanuatu）', pct: 98 }, { name: '其他', pct: 2 }],
    intro:
      '南太平洋的 Y 形群岛链，岛屿多为火山成因，珊瑚礁与热带雨林覆盖大部分海岸。',
    history:
      '公元前 1000 年左右南岛语族抵达。19 世纪英法两国共管（Condominium），这种"双重殖民"在世界上极为罕见。1980 年独立。2015 年帕姆气旋与 2020 年代多次地震火山喷发造成严重损失。',
    culture:
      '陆地跳水（land diving，Naghol）是彭特科斯特岛的成年仪式，用藤蔓绑脚从木塔跳下，被认为是蹦极的前身。猪牙、卡瓦与等级制度构成传统社会结构。',
    landmarks: [
      { name: '亚苏尔火山', desc: '塔纳岛上的活火山，可以走到火山口边缘看熔岩。' },
      { name: '桑托岛蓝洞', desc: '淡水与海水混合的天然泳池，水色湛蓝。' },
      { name: '彭特科斯特岛', desc: '陆地跳水的发源地，每年 4—6 月举行。' },
    ],
    foods: [
      { name: 'Laplap', desc: '木薯或山药泥裹肉，用蕉叶包着烤。' },
      { name: '椰子蟹', desc: '体型巨大的陆生蟹，节庆食物。' },
    ],
    funFact: '瓦努阿图是全球第一个在气候变化诉讼中要求国际法院发表意见的国家推动者之一。',
    cities: [
      { name: '维拉港', lat: -17.73, lng: 168.32, capital: true },
      { name: '卢甘维尔', lat: -15.52, lng: 167.18 },
    ],
  },
]
