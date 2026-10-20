import type { CurriculumUnit, StudyProfile, Subject } from "./types";

export type BacBranchId = "math" | "science" | "technical" | "management" | "literature" | "languages" | "arts";

export type BacBranch = {
  id: BacBranchId;
  name: string;
  description: string;
  subjects: Subject[];
  coreSubjectIds: string[];
};

const s = (id: string, name: string, coefficient: number, core = false, weeklyGoalMin = 90): Subject => ({
  id, name, coefficient, weakness: 3, weeklyGoalMin, core,
});

const common = {
  ar: () => s("sub-ar", "اللغة العربية", 3, false, 120),
  fr: () => s("sub-fr", "اللغة الفرنسية", 2),
  en: () => s("sub-en", "اللغة الإنجليزية", 2),
  hg: () => s("sub-hg", "التاريخ والجغرافيا", 2),
  ph: () => s("sub-ph", "الفلسفة", 2),
  is: () => s("sub-is", "العلوم الإسلامية", 2, false, 60),
};

export const BAC_BRANCHES: BacBranch[] = [
  {
    id: "math", name: "رياضيات", description: "شعبة الرياضيات",
    subjects: [s("sub-math","الرياضيات",7,true,420),s("sub-phys","العلوم الفيزيائية",5,true,300),s("sub-sci","علوم الطبيعة والحياة",2),common.ar(),common.fr(),common.en(),common.hg(),common.ph(),common.is()],
    coreSubjectIds: ["sub-math","sub-phys"],
  },
  {
    id: "science", name: "علوم تجريبية", description: "شعبة العلوم التجريبية",
    subjects: [s("sub-sci","علوم الطبيعة والحياة",6,true,360),s("sub-math","الرياضيات",5,true,300),s("sub-phys","العلوم الفيزيائية",5,true,300),common.ar(),common.fr(),common.en(),common.hg(),common.ph(),common.is()],
    coreSubjectIds: ["sub-sci","sub-math","sub-phys"],
  },
  {
    id: "technical", name: "تقني رياضي / هندسة", description: "المسار التقني والهندسي، ويمكن تخصيص مادة التكنولوجيا من قائمة المواد",
    subjects: [s("sub-tech","التكنولوجيا / الهندسة",7,true,360),s("sub-math","الرياضيات",6,true,360),s("sub-phys","العلوم الفيزيائية",6,true,300),common.ar(),common.fr(),common.en(),common.hg(),common.ph(),common.is()],
    coreSubjectIds: ["sub-tech","sub-math","sub-phys"],
  },
  {
    id: "management", name: "تسيير واقتصاد", description: "شعبة التسيير والاقتصاد",
    subjects: [s("sub-mgmt","التسيير المحاسبي والمالي",6,true,360),s("sub-econ","الاقتصاد والمناجمنت",5,true,300),s("sub-math","الرياضيات",5,true,240),s("sub-law","القانون",2),common.ar(),common.fr(),common.en(),common.hg(),common.ph(),common.is()],
    coreSubjectIds: ["sub-mgmt","sub-econ","sub-math"],
  },
  {
    id: "literature", name: "آداب وفلسفة", description: "شعبة الآداب والفلسفة",
    subjects: [s("sub-ar","اللغة العربية وآدابها",6,true,360),s("sub-ph","الفلسفة",6,true,360),s("sub-hg","التاريخ والجغرافيا",4,true,240),s("sub-fr","اللغة الفرنسية",3),s("sub-en","اللغة الإنجليزية",3),s("sub-math","الرياضيات",2),common.is()],
    coreSubjectIds: ["sub-ar","sub-ph","sub-hg"],
  },
  {
    id: "languages", name: "لغات أجنبية", description: "شعبة اللغات الأجنبية",
    subjects: [s("sub-ar","اللغة العربية وآدابها",5,true,240),s("sub-fr","اللغة الفرنسية",5,true,300),s("sub-en","اللغة الإنجليزية",5,true,300),s("sub-lang3","اللغة الأجنبية الثالثة",4,true,240),s("sub-hg","التاريخ والجغرافيا",4),s("sub-ph","الفلسفة",2),s("sub-math","الرياضيات",2),common.is()],
    coreSubjectIds: ["sub-fr","sub-en","sub-lang3"],
  },
  {
    id: "arts", name: "فنون", description: "شعبة الفنون، مع إمكانية تسمية مادة التخصص الفني حسب المسار",
    subjects: [s("sub-art","الفنون / مادة التخصص",6,true,360),s("sub-ar","اللغة العربية وآدابها",3),s("sub-fr","اللغة الفرنسية",2),s("sub-en","اللغة الإنجليزية",2),s("sub-hg","التاريخ والجغرافيا",2),s("sub-ph","الفلسفة",2),common.is()],
    coreSubjectIds: ["sub-art"],
  },
];

export const DEFAULT_BRANCH_ID: BacBranchId = "math";

export function getBranch(id: string | undefined): BacBranch {
  return BAC_BRANCHES.find((b) => b.id === id) ?? BAC_BRANCHES[0]!;
}

export function subjectsForBranch(id: string | undefined): Subject[] {
  return getBranch(id).subjects.map((subject) => ({ ...subject }));
}

export function profileForBranch(id: string | undefined, current?: StudyProfile): StudyProfile {
  const branch = getBranch(id);
  return {
    oneCorePerDay: current?.oneCorePerDay ?? true,
    coreSubjectIds: [...branch.coreSubjectIds],
    coreDailyMin: current?.coreDailyMin ?? 150,
    secondaryDailyMin: current?.secondaryDailyMin ?? 60,
    reserveMin: current?.reserveMin ?? 30,
  };
}

export function curriculumForBranch(id: string | undefined, base: CurriculumUnit[]): CurriculumUnit[] {
  const allowed = new Set(subjectsForBranch(id).map((subject) => subject.id));
  return base.filter((unit) => allowed.has(unit.subjectId)).map((unit) => ({ ...unit }));
}
