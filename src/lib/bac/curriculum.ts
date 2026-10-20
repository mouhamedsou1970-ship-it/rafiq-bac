import type { CurriculumUnit } from "./types";

// V5 curriculum registry. Only entries backed by Ministry programme documents are seeded here.
// We intentionally keep unverified subjects empty instead of inventing a syllabus.
const unit = (id: string, subjectId: string, order: number, title: string, source: string): CurriculumUnit => ({
  id, subjectId, order, title, status: "not_started", source, verified: true,
});

const MATH = "وزارة التربية الوطنية · برنامج 3AS رياضيات/تقني رياضي";
const PHYS = "وزارة التربية الوطنية · برنامج العلوم الفيزيائية 3AS · رياضيات/تقني رياضي";
const SNV = "وزارة التربية الوطنية · برنامج علوم الطبيعة والحياة 3AS شعبة رياضيات";
const EN = "وزارة التربية الوطنية · Programme d’anglais 3AS · Mathématiques";
const FR = "وزارة التربية الوطنية · Programme de français 3AS · Mathématiques";
const PH = "وزارة التربية الوطنية · التدرجات السنوية للفلسفة 3AS · علوم تجريبية + رياضيات";

export const DEFAULT_CURRICULUM: CurriculumUnit[] = [
  unit("cur-math-01","sub-math",1,"الأعداد والحساب",MATH),
  unit("cur-math-02","sub-math",2,"التحليل: الدوال العددية والنهايات والاستمرارية والاشتقاق",MATH),
  unit("cur-math-03","sub-math",3,"الدالتان الأسية واللوغاريتمية",MATH),
  unit("cur-math-04","sub-math",4,"المتتاليات العددية",MATH),
  unit("cur-math-05","sub-math",5,"الدوال الأصلية والحساب التكاملي",MATH),
  unit("cur-math-06","sub-math",6,"الإحصاء والاحتمالات",MATH),
  unit("cur-math-07","sub-math",7,"الهندسة: الأعداد المركبة والتحويلات",MATH),

  unit("cur-phys-01","sub-phys",1,"دراسة تحولات نووية",PHYS),
  unit("cur-phys-02","sub-phys",2,"المتابعة الزمنية لتحول كيميائي في وسط مائي",PHYS),
  unit("cur-phys-03","sub-phys",3,"دراسة ظواهر كهربائية",PHYS),
  unit("cur-phys-04","sub-phys",4,"تطور تحول جملة كيميائية نحو حالة التوازن",PHYS),
  unit("cur-phys-05","sub-phys",5,"تطور جملة ميكانيكية",PHYS),
  unit("cur-phys-06","sub-phys",6,"مراقبة تطور جملة كيميائية",PHYS),
  unit("cur-phys-07","sub-phys",7,"التطورات المهتزة",PHYS),
  unit("cur-phys-08","sub-phys",8,"مفهوم الموجة",PHYS),

  unit("cur-sci-01","sub-sci",1,"التخصص الوظيفي للبروتينات وتركيب البروتين",SNV),
  unit("cur-sci-02","sub-sci",2,"العلاقة بين بنية البروتين ووظيفته",SNV),
  unit("cur-sci-03","sub-sci",3,"دور البروتينات في الدفاع عن الذات",SNV),
  unit("cur-sci-04","sub-sci",4,"دور البروتينات في الاتصال العصبي",SNV),
  unit("cur-sci-05","sub-sci",5,"التحولات الطاقوية على مستوى الخلية",SNV),

  unit("cur-en-01","sub-en",1,"Comprehension and interpretation of written/oral discourse",EN),
  unit("cur-en-02","sub-en",2,"Language resources and communication",EN),
  unit("cur-en-03","sub-en",3,"Written production and project work",EN),

  unit("cur-fr-01","sub-fr",1,"Compréhension et interprétation des discours",FR),
  unit("cur-fr-02","sub-fr",2,"Production de discours écrits et oraux",FR),
  unit("cur-fr-03","sub-fr",3,"Techniques d’expression et projets",FR),

  unit("cur-ph-01","sub-ph",1,"إشكاليات المعرفة والإدراك",PH),
  unit("cur-ph-02","sub-ph",2,"اللغة والفكر والشعور واللاشعور",PH),
  unit("cur-ph-03","sub-ph",3,"القضايا الفلسفية المرتبطة بالعلوم والقيم",PH),
];

export const curriculumStatusLabel = (status: CurriculumUnit["status"]) =>
  status === "learning" ? "أدرسه الآن" : status === "practice" ? "أتدرب عليه" : status === "review" ? "يحتاج مراجعة" : status === "mastered" ? "متقن" : "لم أبدأ";

export function currentCurriculum(state: { curriculum: CurriculumUnit[] }, subjectId: string) {
  const list = state.curriculum.filter((u) => u.subjectId === subjectId).sort((a, b) => a.order - b.order);
  return list.find((u) => u.status !== "mastered") ?? list.at(-1);
}

export function mergeCurriculum(saved: CurriculumUnit[] | undefined): CurriculumUnit[] {
  if (!saved?.length) return DEFAULT_CURRICULUM.map(x=>({...x}));
  const old = new Map(saved.map(x=>[x.id,x]));
  const seeded = DEFAULT_CURRICULUM.map(x=>({ ...x, status: old.get(x.id)?.status ?? x.status, targetDate: old.get(x.id)?.targetDate }));
  const seededIds = new Set(seeded.map(x=>x.id));
  const legacySeed = /^(math|phys|sci|en|fr|ph)-\d+$/;
  return [...seeded, ...saved.filter(x=>!seededIds.has(x.id) && !legacySeed.test(x.id))];
}
