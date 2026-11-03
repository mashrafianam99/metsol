import React, { useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { calculateResultSummary, getGradeFromScore, getGradePointForGrade, isEarnedCredit, SPECIAL_GRADES } from "../../shared/grading.js";
import Login from "./Login.jsx";
import { apiFetch, apiUrl, disconnectGoogleClassroom, getAccessToken, getGoogleClassroomStatus, redirectToGoogleClassroomConnect, signOut } from "./api.js";
import "./style.css";

const GRADE_OPTIONS = ["A+", "A", "A-", "B+", "B", "B-", "C+", "C", "D", "F", "I", "W", "S", "AB"];
const Transport = React.lazy(() => import("./Transport.jsx"));

const calculateCourseSummary = (course = {}) => {
  const creditValue = Number(course.credit);
  const grade = course.grade || "";
  const gradePoint = getGradePointForGrade(grade);
  const qualityPoint = Number.isFinite(creditValue) && creditValue > 0 ? gradePoint * creditValue : 0;

  return {
    grade,
    gradePoint,
    qualityPoint,
    earned: isEarnedCredit(grade),
    attemptedCredits: Number.isFinite(creditValue) && creditValue > 0 ? creditValue : 0,
  };
};

const calculateCourseRowsSummary = (courseRows) => {
  return calculateResultSummary(courseRows);
};

const getPrintFileName = (prefix, description) => {
  const safeDescription = description
    .normalize("NFKD")
    .replace(/[^\w-]+/gu, "_")
    .replace(/^_+|_+$/gu, "")
    .slice(0, 60);
  return `${prefix}${safeDescription ? `_${safeDescription}` : ""}.pdf`;
};

const printResult = (printRoot, fileName, setMessage) => {
  if (!printRoot || typeof window.print !== "function") {
    setMessage("Printing is not available in this browser.");
    return;
  }

  const previousTitle = document.title;
  const restorePrintState = () => {
    document.title = previousTitle;
    document.body.classList.remove("printing-result");
    printRoot.removeAttribute("data-print-active");
  };

  try {
    document.body.classList.add("printing-result");
    printRoot.setAttribute("data-print-active", "true");
    document.title = fileName;
    window.addEventListener("afterprint", restorePrintState, { once: true });
    window.print();
    setMessage(`In the print dialog, choose “Save as PDF”. Suggested filename: ${fileName}`);
  } catch {
    restorePrintState();
    setMessage("Unable to open the print dialog. Check your browser settings and try again.");
  }
};

const courses = [
  { code: "CSE 310", title: "Artificial Intelligence", teacher: "Dr. Rahman", department: "Department of Computer Science & Engineering", credits: 3, progress: 72 },
  { code: "CSE 320", title: "Database Management", teacher: "Prof. Karim", department: "Department of Computer Science & Engineering", credits: 3, progress: 84 },
  { code: "CSE 330", title: "Data Visualization", teacher: "Dr. Ahmed", department: "Department of Computer Science & Engineering", credits: 3, progress: 65 },
  { code: "CSE 340", title: "Software Engineering", teacher: "Prof. Hasan", department: "Department of Computer Science & Engineering", credits: 3, progress: 91 },
];

const teachers = [
  ...courses.map(({ teacher, department }) => ({ name: teacher, department })),
  { name: "Tawsifur Rahman", department: "Department of Electrical & Electronics Engineering" },
  { name: "Zerin Tasnim Ahmed Mahi", department: "Department of Business Administration" },
];

const assignments = [
  {
    title: "AI Search Algorithm",
    course: "Artificial Intelligence",
    due: "Oct 8, 2026",
    status: "Pending",
  },
  {
    title: "Database Design",
    course: "Database Management",
    due: "Oct 11, 2026",
    status: "Submitted",
  },
  {
    title: "Visualization Project",
    course: "Data Visualization",
    due: "Oct 15, 2026",
    status: "Pending",
  },
];

const cseFaculty = [
  { name: "Professor Dr. Kabir Hussain Chowdhury", designation: "Professor Emeritus" },
  { name: "Professor Dr. Yousuf Mahbubul Islam", designation: "Professor" },
  { name: "Professor Dr. Md. Nazrul Haque Chowdhury", designation: "Dean, School of Science & Technology" },
  { name: "Professor Choudhury M. Mukammel Wahid", designation: "Professor" },
  { name: "Md. Mahfujul Hasan", designation: "Associate Professor · Head, Dept. of CSE" },
  { name: "Md. Shamihul Islam Khan Limon", designation: "Assistant Professor" },
  { name: "Nabila Jannat Rifa", designation: "Lecturer" },
  { name: "Rishad Amin Pulok", designation: "Lecturer" },
  { name: "Salma Akther", designation: "Lecturer" },
  { name: "Abu Jafar Md Jakaria", designation: "Lecturer" },
  { name: "Mayami Das Purkayastha Purba", designation: "Lecturer" },
  { name: "Bushra Azmat Hussain", designation: "Lecturer" },
  { name: "Ruma Das", designation: "Lecturer" },
  { name: "Md. Fahmidur Rahman Sakib", designation: "Lecturer" },
  { name: "Shrabanti Chowdhury", designation: "Lecturer" },
  { name: "Samia Rahman Rima", designation: "Lecturer" },
  { name: "Ruhul Amin", designation: "Lecturer" },
  { name: "Tajbin Jahan", designation: "Lecturer" },
  { name: "Aisha Hayder Chowdhury", designation: "Lecturer" },
  { name: "Abdullah Al Masud", designation: "Lecturer" },
  { name: "Golam Mostofa Naeem", designation: "Lecturer" },
  { name: "Abdul Wadud Shakib", designation: "Lecturer" },
  { name: "Raisa Fairooz", designation: "Lecturer" },
  { name: "Farhana Akter", designation: "Lecturer" },
  { name: "Ms. Ishrar Nazah Chowdhury", designation: "Lecturer" },
  { name: "Mahbuba Akther Liza", designation: "Lecturer" },
  { name: "Bibek Das", designation: "Lecturer" },
  { name: "Mashia Hossain Mim", designation: "Lecturer" },
  { name: "Barnali Sarker Shoumita", designation: "Teaching Assistant" },
  { name: "Arfatul Islam Asif", designation: "Teaching Assistant" },
  { name: "Khalid Bin Selim", designation: "Teaching Assistant" },
  { name: "Nayem Ahmed", designation: "Teaching Assistant" },
  { name: "Akhlak Uz Zaman Ashik", designation: "Assistant Professor", status: "Study leave" },
  { name: "Mst. Shapna Akter", designation: "Lecturer", status: "Study leave" },
  { name: "Nasif Istiak Remon", designation: "Lecturer", status: "Study leave" },
  { name: "Khudeja Khanom Anwara", designation: "Lecturer", status: "Study leave" },
  { name: "Abdullah Alavi", designation: "Lecturer", status: "Study leave" },
  { name: "Jakaria Hossain", designation: "Lecturer", status: "Study leave" },
  { name: "Moshiur Ahmed", designation: "Lecturer" },
  { name: "Iftekhar Hussain", designation: "Lecturer", status: "Study leave" },
  { name: "Nowshin Sharmin", designation: "Lecturer", status: "Study leave" },
].map((faculty) => ({ ...faculty, department: "Computer Science & Engineering" }));

const cseFacultyImages = {
  "Professor Dr. Kabir Hussain Chowdhury": "https://metrouni.edu.bd/images/1781768113.jpeg",
  "Professor Dr. Yousuf Mahbubul Islam": "https://metrouni.edu.bd/images/1769518961.JPG",
  "Professor Dr. Md. Nazrul Haque Chowdhury": "https://metrouni.edu.bd/images/1699259829.png",
  "Professor Choudhury M. Mukammel Wahid": "https://metrouni.edu.bd/images/mu_people_172.png",
  "Md. Mahfujul Hasan": "https://metrouni.edu.bd/images/mu_people_173.png",
  "Md. Shamihul Islam Khan Limon": "https://metrouni.edu.bd/images/1699244626.jpg",
  "Nabila Jannat Rifa": "https://metrouni.edu.bd/images/1699244665.jpg",
  "Rishad Amin Pulok": "https://metrouni.edu.bd/images/1699244763.jpg",
  "Salma Akther": "https://metrouni.edu.bd/images/1699245534.jpg",
  "Abu Jafar Md Jakaria": "https://metrouni.edu.bd/images/1699245600.jpg",
  "Mayami Das Purkayastha Purba": "https://metrouni.edu.bd/images/1699245645.jpg",
  "Bushra Azmat Hussain": "https://metrouni.edu.bd/images/1699248158.jpg",
  "Ruma Das": "https://metrouni.edu.bd/images/1699248293.jpg",
  "Md. Fahmidur Rahman Sakib": "https://metrouni.edu.bd/images/1699248380.jpg",
  "Shrabanti Chowdhury": "https://metrouni.edu.bd/images/1728111524.jpg",
  "Samia Rahman Rima": "https://metrouni.edu.bd/images/1708941597.jpg",
  "Ruhul Amin": "https://metrouni.edu.bd/images/1708941656.jpg",
  "Tajbin Jahan": "https://metrouni.edu.bd/images/1708941837.jpg",
  "Aisha Hayder Chowdhury": "https://metrouni.edu.bd/images/1725982545.jpg",
  "Abdullah Al Masud": "https://metrouni.edu.bd/images/1725983208.jpg",
  "Golam Mostofa Naeem": "https://metrouni.edu.bd/images/1708941740.jpg",
  "Abdul Wadud Shakib": "https://metrouni.edu.bd/images/1708941780.jpg",
  "Raisa Fairooz": "https://metrouni.edu.bd/images/1736759603.jpg",
  "Farhana Akter": "https://metrouni.edu.bd/images/1725983249.jpg",
  "Ms. Ishrar Nazah Chowdhury": "https://metrouni.edu.bd/images/1760862145.jpg",
  "Mahbuba Akther Liza": "https://metrouni.edu.bd/images/1779272443.jpg",
  "Bibek Das": "https://metrouni.edu.bd/images/1779272472.jpeg",
  "Mashia Hossain Mim": "https://metrouni.edu.bd/images/1781018668.jpg",
  "Barnali Sarker Shoumita": "https://metrouni.edu.bd/images/1779272514.png",
  "Arfatul Islam Asif": "https://metrouni.edu.bd/images/1779272684.png",
  "Khalid Bin Selim": "https://metrouni.edu.bd/images/1779275044.jpg",
  "Nayem Ahmed": "https://metrouni.edu.bd/images/1781018747.png",
  "Akhlak Uz Zaman Ashik": "https://metrouni.edu.bd/images/1699248683.png",
  "Mst. Shapna Akter": "https://metrouni.edu.bd/images/1753207274.png",
  "Nasif Istiak Remon": "https://metrouni.edu.bd/images/1699244690.jpg",
  "Khudeja Khanom Anwara": "https://metrouni.edu.bd/images/1715356490.PNG",
  "Abdullah Alavi": "https://metrouni.edu.bd/images/1699248894.jpg",
  "Jakaria Hossain": "https://metrouni.edu.bd/images/1699248935.jpg",
  "Moshiur Ahmed": "https://metrouni.edu.bd/images/1699248573.jpg",
  "Iftekhar Hussain": "https://metrouni.edu.bd/images/1699245564.jpg",
  "Nowshin Sharmin": "https://metrouni.edu.bd/images/1708941893.jpg",
};

const seFaculty = [
  { name: "Professor Dr. Md. Nazrul Haque Chowdhury", designation: "Professor & Dean" },
  { name: "Dr Abdul Rob", designation: "Professor" },
  { name: "Professor Fuad Ahmed", designation: "Professor & Head" },
  { name: "Nazia Sultana Chowdhury", designation: "Assistant Professor" },
  { name: "Rina Paul", designation: "Assistant Professor" },
  { name: "Al Akram Chowdhury", designation: "Assistant Professor" },
  { name: "Wadia Iqbal Chowdhury", designation: "Lecturer" },
  { name: "Iffat Ahmed Chowdhury Nahid", designation: "Lecturer" },
  { name: "Nazia Hassan", designation: "Lecturer" },
  { name: "Syeda Sanjida Rahman", designation: "Lecturer" },
  { name: "Dhiman Dash", designation: "Adjunct Faculty" },
  { name: "Lukman Hussain Nakib", designation: "Adjunct Faculty" },
  { name: "Mridul Kanti Bhattacharjee", designation: "Adjunct Faculty" },
  { name: "Nasrin Akter Tanya", designation: "Lecturer", status: "Study leave" },
].map((faculty) => ({ ...faculty, department: "Software Engineering" }));

const seFacultyImages = {
  "Professor Dr. Md. Nazrul Haque Chowdhury": "https://metrouni.edu.bd/images/1699259829.png",
  "Dr Abdul Rob": "https://metrouni.edu.bd/images/1759838571.jpeg",
  "Professor Fuad Ahmed": "https://metrouni.edu.bd/images/1699259586.png",
  "Nazia Sultana Chowdhury": "https://metrouni.edu.bd/images/1699259607.png",
  "Rina Paul": "https://metrouni.edu.bd/images/1699259619.png",
  "Al Akram Chowdhury": "https://metrouni.edu.bd/images/1699259630.png",
  "Wadia Iqbal Chowdhury": "https://metrouni.edu.bd/images/1699259597.png",
  "Iffat Ahmed Chowdhury Nahid": "https://metrouni.edu.bd/images/1708942850.jpg",
  "Nazia Hassan": "https://metrouni.edu.bd/images/1772347053.jpg",
  "Syeda Sanjida Rahman": "https://metrouni.edu.bd/images/1786192427.jpg",
  "Dhiman Dash": "https://metrouni.edu.bd/images/1739866097.jpg",
  "Lukman Hussain Nakib": "https://metrouni.edu.bd/images/1739866235.jpg",
  "Mridul Kanti Bhattacharjee": "https://metrouni.edu.bd/images/1769930443.jpeg",
  "Nasrin Akter Tanya": "https://metrouni.edu.bd/images/1725983153.JPG",
};

const dataScienceFaculty = [
  { name: "Md. Mushtaq Shahriyar Rafee", designation: "Assistant Professor and Head (In-charge)" },
  { name: "Archi Arani Basak", designation: "Lecturer" },
  { name: "Muhammad Muzammil", designation: "Lecturer" },
  { name: "Nazrul Islam", designation: "Lecturer" },
].map((faculty) => ({ ...faculty, department: "Data Science" }));

const dataScienceFacultyImages = {
  "Md. Mushtaq Shahriyar Rafee": "https://metrouni.edu.bd/images/1764832892.png",
  "Archi Arani Basak": "https://metrouni.edu.bd/images/1764833023.jpg",
  "Muhammad Muzammil": "https://metrouni.edu.bd/images/1764833043.jpg",
  "Nazrul Islam": "https://metrouni.edu.bd/images/1768196311.jpg",
};

const electricalFaculty = [
  { name: "Professor Dr. Md. Nazrul Haque Chowdhury", designation: "Professor & Dean" },
  { name: "Dr Abdul Hoque", designation: "Professor" },
  { name: "Nawshad Ahmed Chowdhury", designation: "Associate Professor", status: "Study leave" },
  { name: "Md. Rahmot Ullah", designation: "Assistant Professor" },
  { name: "Safwan Uddin Ahmed", designation: "Assistant Professor & Head" },
  { name: "Md Anwarul Kawchar", designation: "Lecturer" },
  { name: "Md Hasanur Rahman Sohag", designation: "Lecturer" },
  { name: "Sadman Sakib", designation: "Lecturer" },
  { name: "Md. Fardin Ahasan Maraz", designation: "Lecturer" },
  { name: "Md. Shadman Shakib", designation: "Lecturer" },
  { name: "Ahmed Afif Rafsan", designation: "Lecturer" },
  { name: "Ahmed Istiakur Rahman", designation: "Lecturer" },
  { name: "Md. Imam Mahdi", designation: "Lecturer" },
  { name: "Anika Tabassum", designation: "Lecturer" },
  { name: "Dr. Mohammed Jahirul Islam, PEng", designation: "Professor (Guest Teacher)" },
  { name: "Surajit Sinha", designation: "Assistant Professor", status: "Study leave" },
  { name: "Musarrat Tabassum", designation: "Lecturer", status: "Study leave" },
  { name: "Nafisa Ahmed", designation: "Lecturer", status: "Study leave" },
  { name: "Mahim Ahmed", designation: "Lecturer" },
  { name: "Abdullah Al Numan", designation: "Lecturer", status: "Study leave" },
  { name: "Md Tawsifur Rahman", designation: "Lecturer", status: "Study leave" },
  { name: "Arpita Mazumder", designation: "Lecturer", status: "Study leave" },
].map((faculty) => ({ ...faculty, department: "Electrical & Electronic Engineering" }));

const electricalFacultyImages = {
  "Professor Dr. Md. Nazrul Haque Chowdhury": "https://metrouni.edu.bd/images/1699259829.png",
  "Dr Abdul Hoque": "https://metrouni.edu.bd/images/1759838893.jpeg",
  "Nawshad Ahmed Chowdhury": "https://metrouni.edu.bd/images/1699259841.jpg",
  "Md. Rahmot Ullah": "https://metrouni.edu.bd/images/1699259852.jpg",
  "Safwan Uddin Ahmed": "https://metrouni.edu.bd/images/1756967648.jpg",
  "Md Anwarul Kawchar": "https://metrouni.edu.bd/images/1699260043.jpg",
  "Md Hasanur Rahman Sohag": "https://metrouni.edu.bd/images/1699260128.jpg",
  "Sadman Sakib": "https://metrouni.edu.bd/images/1699260154.jpg",
  "Md. Fardin Ahasan Maraz": "https://metrouni.edu.bd/images/1714902495.jpg",
  "Md. Shadman Shakib": "https://metrouni.edu.bd/images/1708942093.jpg",
  "Ahmed Afif Rafsan": "https://metrouni.edu.bd/images/1708942208.jpg",
  "Ahmed Istiakur Rahman": "https://metrouni.edu.bd/images/1708942247.jpg",
  "Md. Imam Mahdi": "https://metrouni.edu.bd/images/1768671449.JPEG",
  "Anika Tabassum": "https://metrouni.edu.bd/images/1746722863.JPG",
  "Dr. Mohammed Jahirul Islam, PEng": "https://metrouni.edu.bd/images/1699260337.png",
  "Surajit Sinha": "https://metrouni.edu.bd/images/1699260351.png",
  "Musarrat Tabassum": "https://metrouni.edu.bd/images/1699260397.jpg",
  "Nafisa Ahmed": "https://metrouni.edu.bd/images/1699259855.jpg",
  "Mahim Ahmed": "https://metrouni.edu.bd/images/1699260171.jpg",
  "Abdullah Al Numan": "https://metrouni.edu.bd/images/1736842095.jpg",
  "Md Tawsifur Rahman": "https://metrouni.edu.bd/images/1725982672.jpeg",
  "Arpita Mazumder": "https://metrouni.edu.bd/images/1699260103.jpg",
};

const businessFaculty = [
  { name: "Professor Md. Taher Billal Khalifa Ph D", designation: "Professor" },
  { name: "Dr. Tofayel Ahmed", designation: "Professor" },
  { name: "Dr. Md. Masud Rana", designation: "Professor and Dean" },
  { name: "Professor Dr. Mohammad Jamal Uddin", designation: "Professor" },
  { name: "Debashish Roy", designation: "Associate Professor and Head" },
  { name: "Mohammad Kamrul Ahsan", designation: "Associate Professor" },
  { name: "Md. Ziaur Rahman", designation: "Associate Professor" },
  { name: "Md. Gulam Mokta Dhir", designation: "Associate Professor" },
  { name: "Md. Alaul Haque", designation: "Associate Professor" },
  { name: "Nishath Anjum", designation: "Assistant Professor" },
  { name: "Jace Saha", designation: "Assistant Professor" },
  { name: "Dr. Md Rezaul Haque", designation: "Assistant Professor" },
  { name: "Ashikur Rahman", designation: "Lecturer" },
  { name: "Zarin Tasnim Ahmed Mahi", designation: "Lecturer" },
  { name: "Faria Zahan Sarna", designation: "Lecturer" },
  { name: "Mst. Khadija Aktar", designation: "Lecturer" },
  { name: "Fahim Shahriar", designation: "Adjunct Faculty" },
  { name: "Mohammad Asrafuzzaman Yazdani Razu", designation: "Assistant Professor", status: "Study leave" },
  { name: "Dr. Md. Monirul Islam", designation: "Professor (Guest Faculty)" },
  { name: "Dr. Mohammad Shahidul Hoque", designation: "Professor (Guest Faculty)" },
  { name: "Dr. Fazle Elahi Md. Faisal", designation: "Professor (Guest Faculty)" },
  { name: "Dr. Mohammad Mizenur Rahman", designation: "Professor (Guest Faculty)" },
].map((faculty) => ({ ...faculty, department: "Business Administration" }));

const businessFacultyImages = {
  "Professor Md. Taher Billal Khalifa Ph D": "https://metrouni.edu.bd/images/2cTVDvGEXzXajxCrm9NG_1790140779.jpg",
  "Dr. Tofayel Ahmed": "https://metrouni.edu.bd/images/1728986282.png",
  "Dr. Md. Masud Rana": "https://metrouni.edu.bd/images/1734979152.jpg",
  "Professor Dr. Mohammad Jamal Uddin": "https://metrouni.edu.bd/images/1788080746.jpg",
  "Debashish Roy": "https://metrouni.edu.bd/images/1699356867.jpg",
  "Mohammad Kamrul Ahsan": "https://metrouni.edu.bd/images/1768213402.jpg",
  "Md. Ziaur Rahman": "https://metrouni.edu.bd/images/1768213429.jpg",
  "Md. Gulam Mokta Dhir": "https://metrouni.edu.bd/images/1777878266.jpg",
  "Md. Alaul Haque": "https://metrouni.edu.bd/images/1726749188.jpg",
  "Nishath Anjum": "https://metrouni.edu.bd/images/1768213537.jpg",
  "Jace Saha": "https://metrouni.edu.bd/images/1714413157.jpg",
  "Dr. Md Rezaul Haque": "https://metrouni.edu.bd/images/1729934452.jpg",
  "Ashikur Rahman": "https://metrouni.edu.bd/images/1706973447.jpg",
  "Zarin Tasnim Ahmed Mahi": "https://metrouni.edu.bd/images/1708942893.jpg",
  "Faria Zahan Sarna": "https://metrouni.edu.bd/images/1779270811.jpeg",
  "Mst. Khadija Aktar": "https://metrouni.edu.bd/images/1779270851.jpg",
  "Fahim Shahriar": "https://metrouni.edu.bd/images/1769839812.jpeg",
  "Mohammad Asrafuzzaman Yazdani Razu": "https://metrouni.edu.bd/images/1699357402.png",
  "Dr. Md. Monirul Islam": "https://metrouni.edu.bd/images/1699357473.png",
  "Dr. Mohammad Shahidul Hoque": "https://metrouni.edu.bd/images/1699357504.png",
  "Dr. Fazle Elahi Md. Faisal": "https://metrouni.edu.bd/images/1699357539.jpg",
  "Dr. Mohammad Mizenur Rahman": "https://metrouni.edu.bd/images/1699357568.png",
};

const economicsFaculty = [
  { name: "Md. Abdul Aziz", designation: "Professor Emeritus" },
  { name: "Shah Mohammad Hamza Anwar", designation: "Assistant Professor" },
  { name: "Dr. Umme Humayara Manni", designation: "Associate Professor and Head" },
  { name: "Md Amzad Hossain", designation: "Assistant Professor" },
  { name: "Chowdhury Mujaddid Ahmed", designation: "Lecturer" },
  { name: "Nourush Jahan", designation: "Lecturer" },
  { name: "Md Imran Hossain Milon", designation: "Lecturer" },
  { name: "Muhtasim Fuad Ahmed", designation: "Lecturer" },
  { name: "Dr. Muntaha Rakib", designation: "Professor (Guest Faculty)" },
  { name: "Beauty Nahida Sultana", designation: "Assistant Professor", status: "Study leave" },
].map((faculty) => ({ ...faculty, department: "Economics" }));

const economicsFacultyImages = {
  "Md. Abdul Aziz": "https://metrouni.edu.bd/images/1699261431.jpg",
  "Shah Mohammad Hamza Anwar": "https://metrouni.edu.bd/images/1699261501.png",
  "Dr. Umme Humayara Manni": "https://metrouni.edu.bd/images/1699261525.png",
  "Md Amzad Hossain": "https://metrouni.edu.bd/images/1734006011.jpeg",
  "Chowdhury Mujaddid Ahmed": "https://metrouni.edu.bd/images/1706973669.jpg",
  "Nourush Jahan": "https://metrouni.edu.bd/images/1699261603.jpg",
  "Md Imran Hossain Milon": "https://metrouni.edu.bd/images/1736842225.jpg",
  "Muhtasim Fuad Ahmed": "https://metrouni.edu.bd/images/1761024668.jpeg",
  "Dr. Muntaha Rakib": "https://metrouni.edu.bd/images/1699261651.png",
  "Beauty Nahida Sultana": "https://metrouni.edu.bd/images/1699261677.png",
};

const lawFaculty = [
  { name: "Barrister Md. Arash Ali", designation: "Professor" },
  { name: "Professor Sheikh Ashrafur Rahaman", designation: "Dean, School of Law" },
  { name: "Dr. M. Z. Ashraful", designation: "Associate Professor" },
  { name: "Gazi Saiful Hasan", designation: "Associate Professor" },
  { name: "Fatema Imrose", designation: "Assistant Professor" },
  { name: "Mitu Akther", designation: "Assistant Professor" },
  { name: "Taspiea Mostofa", designation: "Lecturer" },
  { name: "Syeda Nazmur Siha Muna", designation: "Lecturer" },
  { name: "Md. Sojibur Rahman", designation: "Lecturer" },
  { name: "Ms. Mahmuda Sultana", designation: "Lecturer" },
  { name: "Md. Sariful Islam", designation: "Lecturer" },
  { name: "Md. Ohidur Rahman Choudhury", designation: "Guest Faculty" },
  { name: "Barrister Riashad Azim", designation: "Guest Faculty" },
].map((faculty) => ({ ...faculty, department: "Law & Justice" }));

const lawFacultyImages = {
  "Barrister Md. Arash Ali": "https://metrouni.edu.bd/images/1699355331.png",
  "Professor Sheikh Ashrafur Rahaman": "https://metrouni.edu.bd/images/1731259726.jpg",
  "Dr. M. Z. Ashraful": "https://metrouni.edu.bd/images/1699355373.png",
  "Gazi Saiful Hasan": "https://metrouni.edu.bd/images/CkyPN1BN25eVr1zjDBdX_1789074072.jpg",
  "Fatema Imrose": "https://metrouni.edu.bd/images/1699355400.jpg",
  "Mitu Akther": "https://metrouni.edu.bd/images/1699355413.png",
  "Taspiea Mostofa": "https://metrouni.edu.bd/images/1699355424.jpg",
  "Syeda Nazmur Siha Muna": "https://metrouni.edu.bd/images/1699355437.jpg",
  "Md. Sojibur Rahman": "https://metrouni.edu.bd/images/1711994993.png",
  "Ms. Mahmuda Sultana": "https://metrouni.edu.bd/images/1708592337.jpg",
  "Md. Sariful Islam": "https://metrouni.edu.bd/images/1746722937.jpg",
  "Md. Ohidur Rahman Choudhury": "https://metrouni.edu.bd/images/1699355751.png",
  "Barrister Riashad Azim": "https://metrouni.edu.bd/images/1699355776.png",
};

const cseFacultyWithImages = cseFaculty.map((faculty) => ({
  ...faculty,
  image: cseFacultyImages[faculty.name],
}));

const seFacultyWithImages = seFaculty.map((faculty) => ({
  ...faculty,
  image: seFacultyImages[faculty.name],
}));

const dataScienceFacultyWithImages = dataScienceFaculty.map((faculty) => ({
  ...faculty,
  image: dataScienceFacultyImages[faculty.name],
}));

const electricalFacultyWithImages = electricalFaculty.map((faculty) => ({
  ...faculty,
  image: electricalFacultyImages[faculty.name],
}));

const businessFacultyWithImages = businessFaculty.map((faculty) => ({
  ...faculty,
  image: businessFacultyImages[faculty.name],
}));

const economicsFacultyWithImages = economicsFaculty.map((faculty) => ({
  ...faculty,
  image: economicsFacultyImages[faculty.name],
}));

const lawFacultyWithImages = lawFaculty.map((faculty) => ({
  ...faculty,
  image: lawFacultyImages[faculty.name],
}));

const allFaculty = [
  ...cseFacultyWithImages,
  ...seFacultyWithImages,
  ...dataScienceFacultyWithImages,
  ...electricalFacultyWithImages,
  ...businessFacultyWithImages,
  ...economicsFacultyWithImages,
  ...lawFacultyWithImages,
];
const facultySources = [
  {
    label: "Computer Science & Engineering",
    url: "https://metrouni.edu.bd/sites/faculty-members/department-of-computer-science-engineering",
  },
  {
    label: "Software Engineering",
    url: "https://metrouni.edu.bd/sites/faculty-members/department-of-software-engineering",
  },
  {
    label: "Data Science",
    url: "https://metrouni.edu.bd/sites/faculty-members/department-of-data-science",
  },
  {
    label: "Electrical & Electronic Engineering",
    url: "https://metrouni.edu.bd/sites/faculty-members/department-of-electrical-electronic-engineering",
  },
  {
    label: "Business Administration",
    url: "https://metrouni.edu.bd/sites/faculty-members/department-of-business-administration",
  },
  {
    label: "Economics",
    url: "https://metrouni.edu.bd/sites/faculty-members/department-of-economics",
  },
  {
    label: "Law & Justice",
    url: "https://metrouni.edu.bd/sites/faculty-members/department-of-law-justice",
  },
];

function App() {
  const [active, setActive] = useState("Dashboard");
  const [dark, setDark] = useState(false);
  const [user, setUser] = useState(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [authMessage, setAuthMessage] = useState("");

  React.useEffect(() => {
    let cancelled = false;

    async function restoreSession() {
      try {
        if (!(await getAccessToken())) return;

        const response = await apiFetch("/api/me");
        if (!response.ok) {
          if (response.status === 401) {
            await signOut().catch(() => {});
            if (!cancelled) setAuthMessage("Your session expired. Please sign in again.");
            return;
          }
          throw new Error("Unable to verify your session. Check your connection and try again.");
        }

        const currentUser = await response.json();
        if (!cancelled) setUser(currentUser);
      } catch (error) {
        if (!cancelled) setAuthMessage(error.message || "Unable to restore your session.");
      } finally {
        if (!cancelled) setAuthLoading(false);
      }
    }

    restoreSession();
    return () => {
      cancelled = true;
    };
  }, []);

  async function handleLogout() {
    try {
      await signOut();
    } catch (error) {
      setAuthMessage(error.message);
    }
    setUser(null);
    setActive("Dashboard");
  }

  if (authLoading) {
    return <div className="login-page" role="status">Restoring your session...</div>;
  }

  if (!user) {
    return (
      <Login
        message={authMessage}
        onLogin={(loggedInUser) => {
          setUser(loggedInUser);
          setAuthMessage("");
        }}
      />
    );
  }

  const menu = [
    ["Dashboard", "⌂"],
    ["Courses", "▣"],
    ["Teachers", "♙"],
    ["Assignments", "✓"],
    ["Google Classroom", "▣"],
    ["Payments", "৳"],
    ["Attendance", "◷"],
    ["Results", "▤"],
    ["Notices", "◉"],
    ["Resources", "▱"],
    ["Quiz", "✎"],
    ["Bus Tracking", "🚌"],
    ["AI Assistant", "✦"],
  ];

  return (
    <div className={dark ? "app dark" : "app"}>
      <aside className="sidebar">
        <div className="brand">
          <div className="brand-logo">MU</div>
          <div>
            <h2>Smart University</h2>
            <span>Metropolitan University</span>
          </div>
        </div>

        <div className="profile-mini">
          <div className="avatar">{user.name?.slice(0, 2).toUpperCase() || "U"}</div>
          <div>
            <strong>{user.name}</strong>
            <span>{user.studentId || user.role}{user.batch ? ` · Batch ${user.batch}` : ""}{user.section ? ` · Section ${user.section}` : ""}</span>
          </div>
        </div>

        <nav>
          {menu.map(([name, icon]) => (
            <button
              key={name}
              className={active === name ? "nav-item active" : "nav-item"}
              onClick={() => setActive(name)}
            >
              <span>{icon}</span>
              {name}
            </button>
          ))}
        </nav>

        <div className="sidebar-bottom">
          <button className="nav-item" onClick={() => setDark(!dark)}>
            <span>{dark ? "☀" : "☾"}</span>
            {dark ? "Light Mode" : "Dark Mode"}
          </button>

          <button className="nav-item">
            <span>⚙</span>
            Settings
          </button>
          <button className="nav-item" onClick={handleLogout}>
            <span>↪</span>
            Sign Out
          </button>
        </div>
      </aside>

      <main className="main">
        <header className={active === "Bus Tracking" ? "topbar bus-topbar" : "topbar"}>
          <div>
            <h1>{active}</h1>
            <p>Welcome back! Here's what's happening today.</p>
          </div>

          <div className="top-actions">
            <button className="icon-button">🔔</button>
            <button className="auth-toggle-button" onClick={handleLogout}>Sign out</button>
            <div className="top-profile">
              <div className="avatar small">{user.name?.slice(0, 2).toUpperCase() || "U"}</div>
              <div>
                <strong>{user.name}</strong>
                <span>{user.department || user.role}</span>
              </div>
            </div>
          </div>
        </header>

        {active === "Dashboard" && <Dashboard setActive={setActive} />}
        {active === "Courses" && <Courses />}
        {active === "Teachers" && <Teachers />}
        {active === "Assignments" && <Assignments user={user} />}
        {active === "Google Classroom" && <GoogleClassroom />}
        {active === "Payments" && <Payments />}
        {active === "Attendance" && <Attendance />}
        {active === "Results" && <Results key={user.role} user={user} />}
        {active === "Notices" && <Notices />}
        {active === "Resources" && <Resources />}
        {active === "Quiz" && <Quiz />}
        {active === "Bus Tracking" && <React.Suspense fallback={<div className="transport-empty">Loading transport…</div>}><Transport user={user} /></React.Suspense>}
        {active === "AI Assistant" && <Assistant />}
      </main>
    </div>
  );
}

function GoogleClassroom() {
  const [status, setStatus] = useState({ connected: false });
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState("");

  const refreshStatus = async () => {
    try {
      setLoading(true);
      const data = await getGoogleClassroomStatus();
      setStatus(data || { connected: false });
      setMessage("");
    } catch (error) {
      setMessage(error.message || "Unable to load Google Classroom status.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    const query = new URLSearchParams(window.location.search);
    const connectionState = query.get("googleClassroom");
    if (connectionState === "connected") {
      setMessage("Google Classroom connected successfully.");
      window.history.replaceState({}, "", window.location.pathname);
    }
    if (connectionState === "error") {
      setMessage("Google Classroom connection failed. Check your Google OAuth settings and try again.");
      window.history.replaceState({}, "", window.location.pathname);
    }
    refreshStatus();
  }, []);

  const handleDisconnect = async () => {
    try {
      setMessage("Disconnecting Google Classroom...");
      await disconnectGoogleClassroom();
      setStatus({ connected: false });
      setMessage("Google Classroom disconnected successfully.");
    } catch (error) {
      setMessage(error.message || "Unable to disconnect Google Classroom.");
    }
  };

  return (
    <section className="card" style={{ maxWidth: 720 }}>
      <div className="page-intro">
        <h2>Google Classroom</h2>
        <p>Connect your Google account to sync course work and assignments with the portal.</p>
      </div>

      {message && <div className="form-message" style={{ marginBottom: 16 }}>{message}</div>}

      {loading ? (
        <p>Loading Classroom connection status...</p>
      ) : status.connected ? (
        <div>
          <div className="course-row" style={{ marginBottom: 20 }}>
            <div className="course-icon">✅</div>
            <div className="course-info">
              <strong>Connected</strong>
              <span>{status.email || "Google account linked"}</span>
            </div>
          </div>
          <div className="quick-grid" style={{ justifyContent: "flex-start" }}>
            <button className="outline-button" onClick={handleDisconnect}>Disconnect</button>
            <button className="primary-button" onClick={() => redirectToGoogleClassroomConnect()}>Reconnect</button>
          </div>
        </div>
      ) : (
        <div>
          <p>Google Classroom is not connected yet.</p>
          <button className="primary-button" onClick={() => redirectToGoogleClassroomConnect()}>Connect Google Classroom</button>
        </div>
      )}
    </section>
  );
}

function Dashboard({ setActive }) {
  const [recentNotices, setRecentNotices] = useState([]);
  const [noticeError, setNoticeError] = useState("");

  useEffect(() => {
    let active = true;
    apiFetch("/api/notices")
      .then(async (response) => {
        if (!response.ok) throw new Error("Unable to load recent notices.");
        const notices = await response.json();
        if (active) setRecentNotices(notices.slice(0, 3));
      })
      .catch((error) => { if (active) setNoticeError(error.message); });
    return () => { active = false; };
  }, []);

  return (
    <>
      <section className="welcome-card">
        <div>
          <span className="eyebrow">THURSDAY, OCTOBER 3, 2026</span>
          <h2>Good afternoon, Student 👋</h2>
          <p>
            Keep track of your courses, assignments, attendance and university
            activities from one place.
          </p>
        </div>
        <div className="welcome-icon">🎓</div>
      </section>

      <section className="stats-grid">
        <Stat icon="📚" title="Enrolled Courses" value="6" />
        <Stat icon="📝" title="Assignments" value="8" />
        <Stat icon="◷" title="Attendance" value="87%" />
        <Stat icon="💳" title="Due Payment" value="৳12,500" />
      </section>

      <div className="dashboard-grid">
        <section className="card">
          <div className="card-header">
            <div>
              <h3>My Courses</h3>
              <span>Current semester</span>
            </div>
            <button onClick={() => setActive("Courses")}>View All</button>
          </div>

          <div className="course-list">
            {courses.slice(0, 3).map((course) => (
              <div className="course-row" key={course.code}>
                <div className="course-icon">📘</div>
                <div className="course-info">
                  <strong>{course.code}</strong>
                  <span>{course.title}</span>
                </div>
                <div className="progress-box">
                  <span>{course.progress}%</span>
                  <div className="progress">
                    <div style={{ width: `${course.progress}%` }} />
                  </div>
                </div>
              </div>
            ))}
          </div>
        </section>

        <section className="card">
          <div className="card-header">
            <div>
              <h3>Upcoming Assignments</h3>
              <span>Don't miss your deadlines</span>
            </div>
            <button onClick={() => setActive("Assignments")}>View All</button>
          </div>

          {assignments.slice(0, 3).map((item) => (
            <div className="assignment-row" key={item.title}>
              <div>
                <strong>{item.title}</strong>
                <span>{item.course}</span>
              </div>
              <div className="assignment-date">
                <span>{item.due}</span>
                <small className={item.status === "Submitted" ? "success" : "warning"}>
                  {item.status}
                </small>
              </div>
            </div>
          ))}
        </section>
      </div>

      <div className="dashboard-grid">
        <section className="card">
          <div className="card-header">
            <div>
              <h3>Recent Notices</h3>
              <span>University announcements</span>
            </div>
            <button onClick={() => setActive("Notices")}>View All</button>
          </div>

          {noticeError && <p role="alert">{noticeError}</p>}
          {!noticeError && !recentNotices.length && <p>No notices have been published for you.</p>}
          {recentNotices.map((notice) => (
            <div className="notice-row" key={notice.id}>
              <div className="notice-dot" />
              <div>
                <strong>{notice.title}</strong>
                <span>{notice.body}</span>
                <small>{new Date(notice.createdAt).toLocaleDateString()}</small>
              </div>
            </div>
          ))}
        </section>

        <section className="card quick-card">
          <h3>Quick Actions</h3>

          <div className="quick-grid">
            <button onClick={() => setActive("Payments")}>💳<span>Pay Fees</span></button>
            <button onClick={() => setActive("Assignments")}>📝<span>Assignments</span></button>
            <button onClick={() => setActive("Google Classroom")}>📚<span>Classroom</span></button>
            <button onClick={() => setActive("Results")}>📊<span>View Results</span></button>
            <button onClick={() => setActive("AI Assistant")}>✦<span>Ask AI</span></button>
          </div>
        </section>
      </div>
    </>
  );
}

function Stat({ icon, title, value }) {
  return (
    <div className="stat-card">
      <div className="stat-icon">{icon}</div>
      <div>
        <span>{title}</span>
        <strong>{value}</strong>
      </div>
    </div>
  );
}

function Courses() {
  return (
    <div>
      <div className="page-intro">
        <h2>My Courses</h2>
        <p>Your enrolled courses for the current semester.</p>
      </div>

      <div className="course-grid">
        {courses.map((course) => (
          <div className="course-card" key={course.code}>
            <div className="course-card-top">
              <span>{course.code}</span>
              <b>{course.credits} Credits</b>
            </div>

            <h3>{course.title}</h3>
            <p>{course.teacher}</p>

            <div className="course-progress">
              <div>
                <span>Course Progress</span>
                <strong>{course.progress}%</strong>
              </div>
              <div className="progress">
                <div style={{ width: `${course.progress}%` }} />
              </div>
            </div>

            <button className="outline-button">Open Course</button>
          </div>
        ))}
      </div>
    </div>
  );
}

function Teachers() {
  const [search, setSearch] = useState("");
  const [department, setDepartment] = useState("All departments");
  const departments = [...new Set(allFaculty.map((faculty) => faculty.department))];
  const normalizedSearch = search.trim().toLocaleLowerCase();
  const filteredFaculty = allFaculty.filter((faculty) => {
    const matchesSearch = `${faculty.name} ${faculty.designation} ${faculty.department}`
      .toLocaleLowerCase()
      .includes(normalizedSearch);
    const matchesDepartment = department === "All departments" || faculty.department === department;
    return matchesSearch && matchesDepartment;
  });

  return (
    <section className="teachers-page">
      <div className="page-intro">
        <h2>Faculty Directory</h2>
        <p>Find faculty members by name or department.</p>
      </div>

      <div className="teacher-search-panel">
        <label className="teacher-search-field">
          <span aria-hidden="true">⌕</span>
          <input
            type="search"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search by name, designation, or department"
            aria-label="Search teachers by name, designation, or department"
          />
        </label>
        <label className="teacher-department-field">
          <span>Department</span>
          <select value={department} onChange={(event) => setDepartment(event.target.value)}>
            <option>All departments</option>
            {departments.map((item) => <option key={item}>{item}</option>)}
          </select>
        </label>
      </div>

      <div className="teacher-results-heading">
        <strong>{filteredFaculty.length} {filteredFaculty.length === 1 ? "faculty member" : "faculty members"}</strong>
        <span>{department === "All departments" ? "All departments" : `Department of ${department}`}</span>
      </div>

      {filteredFaculty.length > 0 ? (
        <div className="teacher-grid">
          {filteredFaculty.map((faculty) => (
            <article className="teacher-card" key={`${faculty.department}-${faculty.name}`}>
              <div className="teacher-avatar" aria-hidden="true">
                {faculty.name.split(/\s+/).filter((part) => !["Dr.", "Professor", "Prof.", "Ms.", "Md."].includes(part)).slice(0, 2).map((part) => part[0]).join("").toUpperCase()}
                {faculty.image && (
                  <img
                    className="teacher-photo"
                    src={faculty.image}
                    alt=""
                    loading="lazy"
                    onError={(event) => { event.currentTarget.hidden = true; }}
                  />
                )}
              </div>
              <div className="teacher-card-content">
                <h3>{faculty.name}</h3>
                <p>{faculty.designation}</p>
                <span className="teacher-department">{faculty.department}</span>
                {faculty.status && <span className="teacher-status">{faculty.status}</span>}
              </div>
            </article>
          ))}
        </div>
      ) : (
        <div className="teacher-empty-state">
          <span aria-hidden="true">⌕</span>
          <h3>No faculty members found</h3>
          <p>Try another name or choose a different department.</p>
        </div>
      )}

      <div className="teacher-source-links">
        {facultySources.map((source) => (
          <a className="teacher-source-link" href={source.url} target="_blank" rel="noreferrer" key={source.label}>
            Official {source.label} faculty listing <span aria-hidden="true">↗</span>
          </a>
        ))}
      </div>
    </section>
  );
}

function Assignments({ user }) {
  const [selectedAssignment, setSelectedAssignment] = useState(null);
  const [coverType, setCoverType] = useState(null);
  const [form, setForm] = useState({
    name: user.name || "",
    studentId: user.studentId || "",
    section: user.section || "",
    department: user.department || "",
    batch: user.batch || "",
    courseCode: courses[0].code,
    teacherName: "",
    teacherDepartment: "",
  });
  const [groupMembers, setGroupMembers] = useState([{ name: "", studentId: "" }]);

  const selectedCourse = courses.find((course) => course.code === form.courseCode);
  const teacherNames = [...new Set(teachers.map((teacher) => teacher.name))];
  const matchingTeachers = teachers.filter((teacher) => teacher.name === form.teacherName);
  const teacherDepartmentChoices = [...new Set(matchingTeachers.map((teacher) => teacher.department))];
  const isGroup = coverType === "group";
  const members = isGroup ? groupMembers : [form];
  const membersAreComplete =
    members.length > 0 &&
    members.every((member) => member.name.trim() && member.studentId.trim()) &&
    (!isGroup || members.length >= 2);
  const canPrint =
    membersAreComplete &&
    form.section.trim() &&
    form.department.trim() &&
    form.batch.trim() &&
    selectedCourse &&
    form.teacherName &&
    form.teacherDepartment;

  function updateForm(field, value) {
    setForm((current) => ({ ...current, [field]: value }));
  }

  function selectTeacher(name) {
    const departments = [...new Set(teachers.filter((teacher) => teacher.name === name).map((teacher) => teacher.department))];
    updateForm("teacherName", name);
    updateForm("teacherDepartment", departments.length === 1 ? departments[0] : "");
  }

  function openAssignment(assignment) {
    const course = courses.find((item) => item.title === assignment.course);
    const courseTeacherDepartments = [...new Set(teachers.filter((teacher) => teacher.name === course?.teacher).map((teacher) => teacher.department))];
    setSelectedAssignment(assignment);
    setCoverType(null);
    setForm((current) => ({
      ...current,
      courseCode: course?.code || current.courseCode,
      teacherName: course?.teacher || current.teacherName,
      teacherDepartment: courseTeacherDepartments.length === 1 ? courseTeacherDepartments[0] : "",
    }));
  }

  function closeAssignment() {
    setSelectedAssignment(null);
    setCoverType(null);
  }

  if (selectedAssignment && !coverType) {
    return (
      <div className="card assignment-detail">
        <button className="back-button" onClick={closeAssignment}>← Back to assignments</button>
        <div className="page-intro">
          <span className="eyebrow assignment-eyebrow">ASSIGNMENT</span>
          <h2>{selectedAssignment.title}</h2>
          <p>{selectedAssignment.course} · Due {selectedAssignment.due}</p>
        </div>
        <h3 className="cover-choice-heading">Choose a cover page</h3>
        <p className="cover-choice-copy">Select the cover page format you want to prepare.</p>
        <div className="cover-choice-grid">
          <button className="cover-choice" onClick={() => setCoverType("individual")}>
            <span className="cover-choice-icon">👤</span>
            <strong>Individual cover page</strong>
            <span>Prepare a cover page for one student.</span>
          </button>
          <button className="cover-choice" onClick={() => setCoverType("group")}>
            <span className="cover-choice-icon">👥</span>
            <strong>Group cover page</strong>
            <span>Add the names and IDs of your group members.</span>
          </button>
        </div>
      </div>
    );
  }

  if (selectedAssignment && coverType) {
    return (
      <div className="cover-workspace">
        <section className="card cover-form-card">
          <button className="back-button" onClick={() => setCoverType(null)}>← Choose cover type</button>
          <div className="page-intro">
            <span className="eyebrow assignment-eyebrow">{isGroup ? "GROUP" : "INDIVIDUAL"} COVER PAGE</span>
            <h2>Enter submission details</h2>
            <p>Complete the details below. The submission date is added automatically.</p>
          </div>

          <div className="cover-form">
            {isGroup ? (
              <div className="cover-field full-width">
                <div className="group-member-heading">
                  <span>Group members</span>
                  <button
                    type="button"
                    className="add-member-button"
                    onClick={() => setGroupMembers((current) => [...current, { name: "", studentId: "" }])}
                  >
                    + Add member
                  </button>
                </div>
                {groupMembers.map((member, index) => (
                  <div className="group-member-fields" key={index}>
                    <label>
                      Name
                      <input
                        required
                        value={member.name}
                        onChange={(event) => setGroupMembers((current) =>
                          current.map((item, itemIndex) => itemIndex === index ? { ...item, name: event.target.value } : item)
                        )}
                        placeholder={`Member ${index + 1} name`}
                      />
                    </label>
                    <label>
                      Student ID
                      <input
                        required
                        value={member.studentId}
                        onChange={(event) => setGroupMembers((current) =>
                          current.map((item, itemIndex) => itemIndex === index ? { ...item, studentId: event.target.value } : item)
                        )}
                        placeholder="Enter student ID"
                      />
                    </label>
                    {groupMembers.length > 1 && (
                      <button
                        type="button"
                        className="remove-member-button"
                        aria-label={`Remove member ${index + 1}`}
                        onClick={() => setGroupMembers((current) => current.filter((_, itemIndex) => itemIndex !== index))}
                      >
                        ×
                      </button>
                    )}
                  </div>
                ))}
              </div>
            ) : (
              <>
                <label>
                  Name
                  <input required value={form.name} onChange={(event) => updateForm("name", event.target.value)} placeholder="Enter your name" />
                </label>
                <label>
                  Student ID
                  <input required value={form.studentId} onChange={(event) => updateForm("studentId", event.target.value)} placeholder="Enter your student ID" />
                </label>
              </>
            )}

            <label>
              Section
              <input required value={form.section} onChange={(event) => updateForm("section", event.target.value)} placeholder="Enter your section" />
            </label>
            <label>
              Department
              <input required value={form.department} onChange={(event) => updateForm("department", event.target.value)} placeholder="Enter your department" />
            </label>
            <label>
              Batch
              <input required value={form.batch} onChange={(event) => updateForm("batch", event.target.value)} placeholder="Enter your batch" />
            </label>
            <label>
              Course
              <select
                required
                value={form.courseCode}
                onChange={(event) => {
                  const course = courses.find((item) => item.code === event.target.value);
                  const departments = [...new Set(teachers.filter((teacher) => teacher.name === course?.teacher).map((teacher) => teacher.department))];
                  setForm((current) => ({
                    ...current,
                    courseCode: event.target.value,
                    teacherName: course?.teacher || current.teacherName,
                    teacherDepartment: departments.length === 1 ? departments[0] : "",
                  }));
                }}
              >
                {courses.map((course) => (
                  <option key={course.code} value={course.code}>{course.title} ({course.code})</option>
                ))}
              </select>
            </label>
            <label>
              Teacher name
              <select required value={form.teacherName} onChange={(event) => selectTeacher(event.target.value)}>
                <option value="">Select a teacher</option>
                {teacherNames.map((name) => <option key={name} value={name}>{name}</option>)}
              </select>
            </label>
            {teacherDepartmentChoices.length > 1 ? (
              <label>
                Teacher department
                <select required value={form.teacherDepartment} onChange={(event) => updateForm("teacherDepartment", event.target.value)}>
                  <option value="">Select the teacher's department</option>
                  {teacherDepartmentChoices.map((department) => <option key={department} value={department}>{department}</option>)}
                </select>
              </label>
            ) : (
              <label>
                Teacher department
                <input readOnly value={form.teacherDepartment} placeholder="Automatically added when you select a teacher" />
              </label>
            )}
          </div>

          <div className="cover-form-actions">
            <span>Submission date: {new Date().toLocaleDateString("en-GB")}</span>
            <button className="primary-button" disabled={!canPrint} onClick={() => window.print()}>
              Print / Save as PDF
            </button>
          </div>
          {!canPrint && <p className="form-hint">Fill in all required details{isGroup ? " and add at least two group members" : ""} to print the cover page.</p>}
        </section>

        <section className="cover-preview-panel">
          <div className="cover-preview-heading">
            <div>
              <h3>Cover page preview</h3>
              <span>Print-ready US Letter layout</span>
            </div>
          </div>
          <article className="cover-page" id="assignment-cover">
            <img className="cover-logo" src="/university-logo.png" alt="Metropolitan University" />
            <div className="cover-course-block">
              <p><strong>Course Name:</strong> {selectedCourse?.title || " "}</p>
              <p><strong>Course Code:</strong> {selectedCourse?.code || " "}</p>
              <p><strong>Assignment on:</strong> {selectedAssignment.title}</p>
            </div>
            <div className="cover-submission-block">
              <strong>Submitted to</strong>
              <p>{form.teacherName || " "}</p>
              <p>{form.teacherDepartment || " "}</p>
              <p>Metropolitan University, Sylhet</p>
            </div>
            <div className="cover-submission-block submitted-by">
              <strong>Submitted by</strong>
              {members.map((member, index) => (
                <p key={index}>{member.name || " "} {isGroup && member.studentId ? `(ID: ${member.studentId})` : ""}</p>
              ))}
              {!isGroup && <p>ID: {form.studentId || " "}</p>}
              <p>Batch: {form.batch || " "}</p>
              <p>Section: {form.section || " "}</p>
              <p>{form.department || " "}</p>
              <p>Metropolitan University, Sylhet</p>
            </div>
            <div className="cover-date-block">
              <strong>Date of Submission</strong>
              <p>{new Date().toLocaleDateString("en-GB")}</p>
            </div>
          </article>
        </section>
      </div>
    );
  }

  return (
    <div className="card">
      <div className="card-header">
        <div>
          <h3>Assignments</h3>
          <span>Open an assignment to prepare its cover page</span>
        </div>
      </div>

      <div className="table">
        <div className="table-head">
          <span>Assignment</span>
          <span>Course</span>
          <span>Due Date</span>
          <span>Status</span>
        </div>

        {assignments.map((a) => (
          <div className="table-row" key={a.title}>
            <strong>{a.title}</strong>
            <span>{a.course}</span>
            <span>{a.due}</span>
            <div className="assignment-row-actions">
              <span className={a.status === "Submitted" ? "badge success" : "badge warning"}>{a.status}</span>
              <button className="open-assignment-button" onClick={() => openAssignment(a)}>Open assignment →</button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function Payments() {
    const [showPaymentForm, setShowPaymentForm] = useState(false);
    const [provider, setProvider] = useState("BKASH");
    const [invoiceId, setInvoiceId] = useState("");
    const [paymentMessage, setPaymentMessage] = useState("");
    const handlePayment = async () => {
      if (!invoiceId.trim()) {
        setPaymentMessage("Please enter your Invoice ID.");
        return;
      }
    
      try {
        const response = await apiFetch(
          "/api/payments/initiate",
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              invoiceId: invoiceId.trim(),
              provider,
            }),
          }
        );
    
        const data = await response.json();
    
        if (!response.ok) {
          setPaymentMessage(
            data.error || "Payment could not be initiated."
          );
          return;
        }
    
        setPaymentMessage(
          `Payment request created. Reference: ${
            data.reference || "N/A"
          } — Status: PENDING`
        );
      } catch (error) {
        setPaymentMessage("Unable to connect to the payment server.");
      }
    };
  return (
    <>
      <div className="stats-grid">
        <Stat icon="💰" title="Semester Fee" value="৳45,000" />
        <Stat icon="✓" title="Paid" value="৳32,500" />
        <Stat icon="!" title="Remaining" value="৳12,500" />
      </div>

      <div className="card">
        <div className="card-header">
          <div>
            <h3>Payment History</h3>
            <span>Your recent university payments</span>
          </div>
          <button
  className="primary-button"
  onClick={() => setShowPaymentForm(true)}
>
  Make Payment
</button>
        </div>

        <div className="table">
          {[
            ["Semester Fee", "৳20,000", "Sep 15, 2026", "SUCCESS"],
            ["Tuition Fee", "৳12,500", "Aug 20, 2026", "SUCCESS"],
            ["Registration", "৳5,000", "Aug 5, 2026", "SUCCESS"],
          ].map((p) => (
            <div className="table-row" key={p[0]}>
              <strong>{p[0]}</strong>
              <span>{p[1]}</span>
              <span>{p[2]}</span>
              <span className="badge success">{p[3]}</span>
            </div>
          ))}
        </div>
      </div>
      {showPaymentForm && (
  <div className="card payment-form-card">
    <div className="card-header">
      <div>
        <h3>Make Payment</h3>
        <span>Pay your university fee</span>
      </div>
    </div>

    <div className="payment-form">
      <label>
        Invoice ID
        <input
          type="text"
          value={invoiceId}
          onChange={(e) => setInvoiceId(e.target.value)}
          placeholder="Enter invoice ID"
        />
      </label>

      <label>
        Payment Method
        <select
          value={provider}
          onChange={(e) => setProvider(e.target.value)}
        >
          <option value="BKASH">bKash</option>
          <option value="NAGAD">Nagad</option>
        </select>
      </label>

      <div className="payment-actions">
        <button
          className="primary-button"
          onClick={() => {
            setPaymentMessage(
              "Payment request created successfully. Status: PENDING"
            );
          }}
        >
          Pay Now
        </button>

        <button
          className="secondary-button"
          onClick={() => setShowPaymentForm(false)}
        >
          Cancel
        </button>
      </div>

      {paymentMessage && (
        <p className="payment-message">{paymentMessage}</p>
      )}
    </div>
  </div>
)}
    </>
  );
}

function Attendance() {
  const data = [
    ["Artificial Intelligence", "92%", "Excellent"],
    ["Database Management", "88%", "Good"],
    ["Data Visualization", "81%", "Good"],
    ["Software Engineering", "95%", "Excellent"],
  ];

  return (
    <div className="card">
      <div className="card-header">
        <div>
          <h3>Attendance</h3>
          <span>Current semester attendance</span>
        </div>
      </div>

      {data.map((item) => (
        <div className="attendance-row" key={item[0]}>
          <div>
            <strong>{item[0]}</strong>
            <span>{item[2]}</span>
          </div>

          <div className="attendance-progress">
            <div className="progress">
              <div style={{ width: item[1] }} />
            </div>
            <strong>{item[1]}</strong>
          </div>
        </div>
      ))}
    </div>
  );
}

function Results({ user }) {
  const [courseRows, setCourseRows] = useState([{ id: 1, name: "", credit: "", grade: "" }]);
  const [scoreInput, setScoreInput] = useState("");
  const [courseScoreInputs, setCourseScoreInputs] = useState({
    midterm: "",
    classTest: "",
    attendance: "",
    finalExam: "",
  });
  const [validationMessage, setValidationMessage] = useState("");
  const [calculatedSummary, setCalculatedSummary] = useState(null);
  const [officialResult, setOfficialResult] = useState(null);
  const [calculatorPrintMessage, setCalculatorPrintMessage] = useState("");
  const calculatorPrintRef = useRef(null);

  const updateCourseRow = (id, field, value) => {
    setCourseRows((previousRows) =>
      previousRows.map((row) => {
        if (row.id !== id) return row;
        const nextRow = { ...row, [field]: value };
        return nextRow;
      })
    );
    setCalculatedSummary(null);
    setValidationMessage("");
  };

  const addCourseRow = () => {
    setCourseRows((previousRows) => [
      ...previousRows,
      { id: Date.now(), name: "", credit: "", grade: "" },
    ]);
    setCalculatedSummary(null);
    setValidationMessage("");
  };

  const removeCourseRow = (id) => {
    setCourseRows((previousRows) => {
      if (previousRows.length === 1) {
        return previousRows;
      }
      return previousRows.filter((row) => row.id !== id);
    });
    setCalculatedSummary(null);
    setValidationMessage("");
  };

  const scoreResult = (() => {
    if (scoreInput === "" || scoreInput === null || scoreInput === undefined) return null;

    const numericScore = Number(scoreInput);
    if (!Number.isFinite(numericScore)) {
      return { error: "Enter a score between 0 and 100." };
    }
    if (numericScore < 0 || numericScore > 100) {
      return { error: "Score must be between 0 and 100." };
    }

    return getGradeFromScore(numericScore);
  })();

  const scoreLimits = { midterm: 30, classTest: 20, attendance: 10, finalExam: 40 };
  const scoreFieldsComplete = Object.values(courseScoreInputs).every((value) => value !== "");
  const courseScoreTotal = scoreFieldsComplete
    ? Object.values(courseScoreInputs).reduce((sum, value) => sum + Number(value), 0)
    : null;
  const courseScoreError = Object.entries(courseScoreInputs).some(([field, value]) => (
    value !== "" && (!Number.isFinite(Number(value)) || Number(value) < 0 || Number(value) > scoreLimits[field])
  ))
    ? "Enter a valid score within each assessment's maximum."
    : courseScoreTotal !== null && courseScoreTotal > 100
      ? "The total course score cannot exceed 100."
      : "";
  const courseScoreResult = courseScoreTotal !== null && !courseScoreError
    ? getGradeFromScore(courseScoreTotal)
    : null;

  const summaryRows = courseRows.map((row) => {
    const computed = calculateCourseSummary(row);
    return {
      ...row,
      ...computed,
    };
  });
  const summary = calculatedSummary;

  const calculateSemesterGpa = () => {
    for (const [index, row] of courseRows.entries()) {
      if (!row.name.trim()) {
        setValidationMessage(`Enter a course name for subject ${index + 1}.`);
        return;
      }

      const credit = Number(row.credit);
      if (row.credit === "" || !Number.isFinite(credit) || credit <= 0) {
        setValidationMessage(`Enter positive credit hours for ${row.name.trim()}.`);
        return;
      }

      if (!GRADE_OPTIONS.includes(row.grade)) {
        setValidationMessage(`Select a supported grade for ${row.name.trim()}.`);
        return;
      }
    }

    setCalculatedSummary(calculateCourseRowsSummary(courseRows));
    setValidationMessage("");
    setCalculatorPrintMessage("");
  };

  const resetCalculator = () => {
    setCourseRows([{ id: Date.now(), name: "", credit: "", grade: "" }]);
    setCalculatedSummary(null);
    setValidationMessage("");
    setCalculatorPrintMessage("");
  };

  const printCalculatorResult = () => {
    const fileName = getPrintFileName("GPA_Calculation", new Date().toISOString().slice(0, 10));
    printResult(calculatorPrintRef.current, fileName, setCalculatorPrintMessage);
  };
  const displaySemesterGpa = summary ? Number(summary.semesterGpa).toFixed(2) : "—";
  const calculatorPrintDate = new Date().toLocaleDateString();

  return (
    <div className="results-page">
      <section className="results-hero" id="result-overview">
        <div className="results-hero-copy">
          <span className="results-eyebrow">ACADEMIC RECORD</span>
          <h2>Academic Results</h2>
          <p>Review available university results, calculate a semester GPA, and print or save a result as a PDF.</p>
          <nav className="results-section-nav" aria-label="Result sections">
            <a href="#official-result">Official result</a>
            <a href="#gpa-calculator">GPA calculator</a>
          </nav>
        </div>
        {user?.role === "STUDENT" && (
          <div className="results-student-card">
            <span className="results-student-avatar" aria-hidden="true">{user.name?.slice(0, 1).toUpperCase() || "S"}</span>
            <div>
              <strong>{user.name || "Signed-in student"}</strong>
              {user.studentId && <span>Student ID · {user.studentId}</span>}
              {user.department && <span>{user.department}</span>}
              {user.batch && <span>Batch · {user.batch}</span>}
              {user.section && <span>Section · {user.section}</span>}
            </div>
          </div>
        )}
      </section>

      <section className="results-overview" aria-label="Academic result overview">
        <article className="result-overview-card result-overview-primary">
          <span>{officialResult?.summary?.gpaSource === "university" ? "University-reported GPA" : officialResult?.summary?.gpaSource === "calculated" ? "GPA from imported grades" : "Official GPA"}</span>
          <strong>{officialResult?.found && officialResult.summary.gpa !== null ? Number(officialResult.summary.gpa).toFixed(2) : "—"}</strong>
          <small>{officialResult?.found ? officialResult.summary.gpaSource === "university" ? "Reported in the university PDF" : officialResult.summary.gpaSource === "calculated" ? "Calculated from imported course grades" : "No unambiguous GPA is available in the imported result" : "Available when an official result is found"}</small>
        </article>
        <article className="result-overview-card">
          <span>{officialResult?.summary?.cgpaSource === "university" ? "University-reported CGPA" : officialResult?.summary?.cgpaSource === "calculated" ? "CGPA from imported grades" : "Official CGPA"}</span>
          <strong>{officialResult?.found && officialResult.summary.cgpa !== null ? Number(officialResult.summary.cgpa).toFixed(2) : "—"}</strong>
          <small>{officialResult?.found ? officialResult.summary.cgpaSource === "university" ? "Reported in the university PDF" : officialResult.summary.cgpaSource === "calculated" ? "Calculated from imported course grades" : "No unambiguous CGPA is available in the imported result" : "Not available until an official result is found"}</small>
        </article>
        <article className="result-overview-card">
          <span>Attempted credits</span>
          <strong>{officialResult?.found ? Number(officialResult.summary.totalAttemptedCredits).toFixed(2) : "—"}</strong>
          <small>{officialResult?.found ? `${officialResult.records.length} course records in the imported result` : "Shown only when result data is available"}</small>
        </article>
        <article className="result-overview-card">
          <span>Result status</span>
          <strong className="result-status-value">{officialResult?.found ? "Available" : officialResult?.found === false ? "Not found" : officialResult ? "Unavailable" : "Checking"}</strong>
          <small>{officialResult?.found ? officialResult.source.label : officialResult?.found === false ? "No matching published result was found" : "Official records are never estimated or fabricated"}</small>
        </article>
      </section>

      <OfficialUniversityResult onOfficialResult={setOfficialResult} />

      <section className="card calculator-card" id="gpa-calculator">
        <div className="card-header result-calculator-header">
          <div>
            <span className="results-eyebrow">ESTIMATE</span>
            <h3>Semester GPA Calculator</h3>
            <span>Enter your course grades to estimate semester GPA using the Metropolitan University grading policy. This is not an official university result.</span>
          </div>
        </div>

        <div className="calculator-grid">
          <div className="calculator-body">
            <div className="calculator-table" role="table" aria-label="Semester GPA course inputs">
              <div className="calculator-table-head">
                <span role="columnheader">Course Name</span>
                <span role="columnheader">Credit Hours</span>
                <span role="columnheader">Grade</span>
                <span role="columnheader">Grade Point</span>
                <span role="columnheader">Quality Point</span>
                <span role="columnheader">Earned Credit</span>
                <span role="columnheader">Remove</span>
              </div>

              {summaryRows.map((row) => {
                const computed = calculateCourseSummary(row);
                const gradePoint = computed.gradePoint;
                const qualityPoint = computed.qualityPoint;
                const earned = computed.earned ? "Yes" : "No";

                return (
                  <div className="calculator-table-row" key={row.id} role="row">
                    <input
                      type="text"
                      value={row.name}
                      onChange={(event) => updateCourseRow(row.id, "name", event.target.value)}
                      placeholder="Course name"
                      aria-label="Course name"
                    />
                    <input
                      type="number"
                      min="0.01"
                      step="0.5"
                      value={row.credit}
                      onChange={(event) => updateCourseRow(row.id, "credit", event.target.value)}
                      placeholder="3"
                      aria-label="Credit hours"
                    />
                    <select value={row.grade} onChange={(event) => updateCourseRow(row.id, "grade", event.target.value)} aria-label="Course grade">
                      <option value="">Select grade</option>
                      {GRADE_OPTIONS.map((grade) => (
                        <option key={grade} value={grade}>{grade}</option>
                      ))}
                    </select>
                    <span className="calculator-value" data-label="Grade point">{row.grade ? Number(gradePoint).toFixed(2) : "-"}</span>
                    <span className="calculator-value" data-label="Quality point">{row.grade && Number(row.credit) > 0 ? Number(qualityPoint).toFixed(2) : "-"}</span>
                    <span className={`calculator-value ${earned === "Yes" ? "earned" : "not-earned"}`} data-label="Earned credit">{row.grade ? earned : "-"}</span>
                    <button type="button" className="remove-row-button" onClick={() => removeCourseRow(row.id)} aria-label={`Remove ${row.name || "course"}`} disabled={courseRows.length === 1}>
                      ×
                    </button>
                  </div>
                );
              })}
            </div>

            {validationMessage && <div className="validation-message">{validationMessage}</div>}

            <div className="calculator-actions">
              <button type="button" className="secondary-button" onClick={addCourseRow}>+ Add subject</button>
              <div className="calc-btn-stack">
                {summary && <button type="button" className="secondary-button" onClick={printCalculatorResult}>Print / Save estimate as PDF</button>}
                <button type="button" className="primary-button" onClick={calculateSemesterGpa}>Calculate GPA</button>
                <button type="button" className="secondary-button" onClick={resetCalculator}>Reset</button>
              </div>
            </div>

            <div className="summary-card" aria-live="polite">
              <h4>Estimated semester GPA</h4>
              {summary ? (
                <>
                  <p className="calculator-result-notice">Estimate only — not an official university result.</p>
                  <div className="summary-grid">
                    <div><span>Semester GPA</span><strong>{displaySemesterGpa}</strong></div>
                    <div><span>Total quality points</span><strong>{Number(summary.totalQualityPoints).toFixed(2)}</strong></div>
                    <div><span>Attempted credits</span><strong>{Number(summary.attemptedCredits).toFixed(2)}</strong></div>
                    <div><span>Earned credits</span><strong>{Number(summary.earnedCredits).toFixed(2)}</strong></div>
                    <div><span>Courses</span><strong>{summary.courseCount}</strong></div>
                  </div>
                </>
              ) : (
                <p className="calculator-empty-state">Add each course, credit value, and grade, then calculate to see your estimate.</p>
              )}
            </div>
            {calculatorPrintMessage && <p className="result-action-message" role="status">{calculatorPrintMessage}</p>}

            <div className="calculator-print-sheet" ref={calculatorPrintRef} data-print-root>
              <header className="result-print-header">
                <p>Metropolitan University · Smart University Portal</p>
                <h1>Semester GPA Estimate</h1>
                <p>This is a student-generated estimate, not an official university result.</p>
              </header>
              {user?.role === "STUDENT" && (
                <div className="result-print-student">
                  {user.name && <p><strong>Student:</strong> {user.name}</p>}
                  {user.studentId && <p><strong>Student ID:</strong> {user.studentId}</p>}
                  {user.department && <p><strong>Department:</strong> {user.department}</p>}
                  {user.batch && <p><strong>Batch:</strong> {user.batch}</p>}
                  {user.section && <p><strong>Section:</strong> {user.section}</p>}
                </div>
              )}
              {summary && (
                <>
                  <table className="result-print-table">
                    <thead><tr><th>Course</th><th>Credits</th><th>Grade</th><th>Grade point</th><th>Quality point</th></tr></thead>
                    <tbody>{summaryRows.map((row) => (
                      <tr key={row.id}>
                        <td>{row.name}</td><td>{Number(row.credit).toFixed(2)}</td><td>{row.grade}</td>
                        <td>{Number(row.gradePoint).toFixed(2)}</td><td>{Number(row.qualityPoint).toFixed(2)}</td>
                      </tr>
                    ))}</tbody>
                  </table>
                  <div className="result-print-summary">
                    <p><strong>Estimated semester GPA:</strong> {displaySemesterGpa}</p>
                    <p><strong>Attempted credits:</strong> {Number(summary.attemptedCredits).toFixed(2)}</p>
                    <p><strong>Earned credits:</strong> {Number(summary.earnedCredits).toFixed(2)}</p>
                  </div>
                </>
              )}
              <p className="result-print-date">Generated {calculatorPrintDate}</p>
            </div>
          </div>

          <div className="calculator-side-panel">
            <div className="mini-panel">
              <h4>Marks to Grade</h4>
              <label>
                <span>Score</span>
                <input
                  type="number"
                  min="0"
                  max="100"
                  step="0.01"
                  value={scoreInput}
                  onChange={(event) => setScoreInput(event.target.value)}
                  placeholder="84"
                  aria-label="Score out of 100"
                />
              </label>

              {scoreResult && !scoreResult.error ? (
                <div className="grade-output">
                  <div>
                    <span>Letter Grade</span>
                    <strong>{scoreResult.grade}</strong>
                  </div>
                  <div>
                    <span>Grade Point</span>
                    <strong>{Number(scoreResult.gradePoint).toFixed(2)}</strong>
                  </div>
                </div>
              ) : null}

              {scoreResult && scoreResult.error ? (
                <div className="validation-message">{scoreResult.error}</div>
              ) : null}
            </div>

            <div className="mini-panel">
              <h4>Course Score Calculator</h4>
              <div className="score-fields">
                <label>
                  <span>Mid-term Exam</span>
                  <input type="number" min="0" max="30" value={courseScoreInputs.midterm} onChange={(event) => setCourseScoreInputs((current) => ({ ...current, midterm: event.target.value }))} aria-label="Mid-term exam score, maximum 30" />
                </label>
                <label>
                  <span>Class Test</span>
                  <input type="number" min="0" max="20" value={courseScoreInputs.classTest} onChange={(event) => setCourseScoreInputs((current) => ({ ...current, classTest: event.target.value }))} aria-label="Class test score, maximum 20" />
                </label>
                <label>
                  <span>Attendance & Participation</span>
                  <input type="number" min="0" max="10" value={courseScoreInputs.attendance} onChange={(event) => setCourseScoreInputs((current) => ({ ...current, attendance: event.target.value }))} aria-label="Attendance and participation score, maximum 10" />
                </label>
                <label>
                  <span>Final Exam</span>
                  <input type="number" min="0" max="40" value={courseScoreInputs.finalExam} onChange={(event) => setCourseScoreInputs((current) => ({ ...current, finalExam: event.target.value }))} aria-label="Final exam score, maximum 40" />
                </label>
              </div>

              <div className="score-total-box">
                <span>Total Score</span>
                <strong>{courseScoreTotal === null ? "— / 100" : `${courseScoreTotal} / 100`}</strong>
              </div>

              {courseScoreResult && !courseScoreResult.error ? (
                <div className="grade-output">
                  <div>
                    <span>Letter Grade</span>
                    <strong>{courseScoreResult.grade}</strong>
                  </div>
                  <div>
                    <span>Grade Point</span>
                    <strong>{Number(courseScoreResult.gradePoint).toFixed(2)}</strong>
                  </div>
                </div>
              ) : null}
              {courseScoreError && <div className="validation-message" role="alert">{courseScoreError}</div>}
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}

function OfficialUniversityResult({ onOfficialResult }) {
  const [accountRole, setAccountRole] = useState("");
  const [officialResult, setOfficialResult] = useState(null);
  const [loading, setLoading] = useState(true);
  const [selectedFile, setSelectedFile] = useState(null);
  const [preview, setPreview] = useState(null);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [uploadBusy, setUploadBusy] = useState(false);
  const [message, setMessage] = useState("");
  const fileInputRef = useRef(null);
  const officialPrintRef = useRef(null);
  const [printMessage, setPrintMessage] = useState("");
  const readJsonResponse = (response) => response.json().catch(() => ({}));

  const loadOfficialResult = async () => {
    const response = await apiFetch("/api/results/official");
    const data = await readJsonResponse(response);
    if (!response.ok) throw new Error(data.error || "Unable to load your official result.");
    setOfficialResult(data);
    onOfficialResult(data);
  };

  useEffect(() => {
    let active = true;
    const loadAccount = async () => {
      let loadedRole = "";
      try {
        const response = await apiFetch("/api/me");
        const user = await readJsonResponse(response);
        if (!response.ok) throw new Error(user.error || "Sign in to view your official result.");
        if (!active) return;
        loadedRole = user.role || "";
        setAccountRole(loadedRole);
        if (user.role === "STUDENT") {
          await loadOfficialResult();
        }
      } catch (error) {
        if (active) {
          setMessage(error.message || "Unable to connect to the result service.");
          if (loadedRole === "STUDENT") onOfficialResult({ found: null });
        }
      } finally {
        if (active) setLoading(false);
      }
    };

    loadAccount();
    return () => { active = false; };
  }, []);

  const sendPdf = async (endpoint, file) => {
    const token = await getAccessToken();
    return new Promise((resolve, reject) => {
    if (!token) {
      reject(new Error("Sign in with an administrator account to upload result documents."));
      return;
    }

    const formData = new FormData();
    formData.append("file", file);
    const request = new XMLHttpRequest();
    request.open("POST", apiUrl(endpoint));
    request.setRequestHeader("Authorization", `Bearer ${token}`);
    request.upload.onprogress = (event) => {
      if (event.lengthComputable) setUploadProgress(Math.round((event.loaded / event.total) * 100));
    };
    request.onerror = () => reject(new Error("Unable to connect to the result service."));
    request.onload = () => {
      let data;
      try {
        data = JSON.parse(request.responseText);
      } catch {
        reject(new Error(request.status === 401
          ? "Sign in before requesting result documents."
          : request.status === 403
            ? "You are not authorized to import result documents."
            : "The result service returned an unreadable response."));
        return;
      }
      if (request.status < 200 || request.status >= 300) {
        reject(new Error(data.error || "The result PDF could not be processed."));
        return;
      }
      resolve(data);
    };
    request.send(formData);
    });
  };

  const handlePreview = async () => {
    if (!selectedFile) {
      setMessage("Choose a university result PDF first.");
      return;
    }
    if (!selectedFile.name.toLowerCase().endsWith(".pdf")) {
      setMessage("Choose a file with the .pdf extension.");
      return;
    }

    setUploadBusy(true);
    setUploadProgress(0);
    setMessage("");
    setPreview(null);
    try {
      setPreview(await sendPdf("/api/admin/results/import/preview", selectedFile));
    } catch (error) {
      setMessage(error.message);
    } finally {
      setUploadBusy(false);
    }
  };

  const handleImport = async () => {
    if (!selectedFile || !preview || preview.duplicate) return;
    setUploadBusy(true);
    setUploadProgress(0);
    setMessage("");
    try {
      const result = await sendPdf("/api/admin/results/import", selectedFile);
      setMessage(result.message);
      setPreview(null);
      setSelectedFile(null);
      if (fileInputRef.current) fileInputRef.current.value = "";
    } catch (error) {
      setMessage(error.message);
    } finally {
      setUploadBusy(false);
    }
  };

  const cancelPreview = () => {
    setPreview(null);
    setSelectedFile(null);
    setMessage("");
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const semesterLabel = officialResult?.records
    ? [...new Set(officialResult.records.map((record) => [record.semester, record.academicYear].filter(Boolean).join(" ")).filter(Boolean))].join("_")
    : "";
  const officialFileName = getPrintFileName("Official_Academic_Result", semesterLabel);
  const printOfficialResult = () => printResult(officialPrintRef.current, officialFileName, setPrintMessage);
  const officialPrintDate = new Date().toLocaleDateString();

  return (
    <section className="card official-result-card" id="official-result">
      {accountRole === "ADMIN" ? (
        <>
          <div className="card-header">
            <div>
              <h3>Upload University Result PDF</h3>
              <span>Admin-only import · PDF files up to 15 MB</span>
            </div>
          </div>
          <div className="result-upload-controls">
            <input
              ref={fileInputRef}
              type="file"
              accept="application/pdf,.pdf"
              onChange={(event) => {
                setSelectedFile(event.target.files?.[0] ?? null);
                setPreview(null);
                setMessage("");
              }}
              disabled={uploadBusy}
            />
            <button type="button" className="primary-button" onClick={handlePreview} disabled={uploadBusy || !selectedFile}>
              {uploadBusy ? "Processing..." : "Preview PDF"}
            </button>
          </div>
          {uploadBusy && (
            <div className="result-upload-progress" aria-live="polite">
              <progress max="100" value={uploadProgress} />
              <span>{uploadProgress}% uploaded</span>
            </div>
          )}
          {preview && (
            <div className="result-import-preview">
              <h4>Import Preview</h4>
              <dl>
                <div><dt>File</dt><dd>{preview.fileName}</dd></div>
                <div><dt>Students detected</dt><dd>{preview.studentCount.toLocaleString()}</dd></div>
                <div><dt>Result records</dt><dd>{preview.recordCount.toLocaleString()}</dd></div>
                <div><dt>Status</dt><dd>{preview.duplicate ? "Already imported" : "Parsed successfully"}</dd></div>
              </dl>
              <div className="result-import-actions">
                <button type="button" className="primary-button" onClick={handleImport} disabled={uploadBusy || preview.duplicate}>
                  Import Results
                </button>
                <button type="button" className="secondary-button" onClick={cancelPreview} disabled={uploadBusy}>Cancel</button>
              </div>
            </div>
          )}
          {message && <p className="result-import-message" role="status">{message}</p>}
        </>
      ) : (
        <div className="official-result-print-sheet" ref={officialPrintRef} data-print-root>
          <div className="card-header">
            <div>
              <h3>Official University Result</h3>
              <span>Securely matched to the Student ID on your signed-in account. The university-issued PDF import is the source of this record.</span>
            </div>
          </div>
          {loading ? (
            <p className="official-result-message">Loading your result…</p>
          ) : accountRole !== "STUDENT" ? (
            <p className="official-result-message">{message || "Sign in as a student to view your official result."}</p>
          ) : officialResult?.found ? (
            <>
              <div className="official-result-actions">
                <button type="button" className="primary-button" onClick={printOfficialResult}>Print / Save as PDF</button>
                <span>Choose “Save as PDF” in your browser’s print dialog.</span>
              </div>
              {printMessage && <p className="result-action-message" role="status">{printMessage}</p>}
              <header className="result-print-header official-print-heading">
                <p>Metropolitan University · Smart University Portal</p>
                <h1>Academic Result</h1>
                <p>Official result imported from a university-provided result PDF.</p>
              </header>
              <div className="official-student-details">
                <div><span>Student Name</span><strong>{officialResult.student.name}</strong></div>
                <div><span>Student ID</span><strong>{officialResult.student.studentId}</strong></div>
                <div><span>Semester</span><strong>{[...new Set(officialResult.records.map((record) => record.semester).filter(Boolean))].join(", ") || "Not specified"}</strong></div>
              </div>
              <div className="official-result-table">
                <div className="official-result-table-head">
                  <span>Semester</span><span>Course Code</span><span>Course</span><span>Credit</span><span>Marks</span><span>Grade</span><span>Grade Point</span>
                </div>
                {officialResult.records.map((record, index) => (
                  <div className="official-result-table-row" key={`${record.courseCode || record.courseTitle}-${record.semester}-${index}`}>
                    <span data-label="Semester">{[record.semester, record.academicYear].filter(Boolean).join(" · ") || "—"}</span>
                    <span data-label="Course Code">{record.courseCode || "—"}</span>
                    <strong data-label="Course">{record.courseTitle || "—"}</strong>
                    <span data-label="Credit">{record.credits}</span>
                    <span data-label="Marks">{record.marks ?? "—"}</span>
                    <span data-label="Grade">{record.grade}</span>
                    <span data-label="Grade Point">{Number(record.gradePoint).toFixed(2)}</span>
                  </div>
                ))}
              </div>
              <table className="official-result-print-table">
                <thead>
                  <tr><th>Semester</th><th>Course code</th><th>Course</th><th>Credits</th><th>Marks</th><th>Grade</th><th>Grade point</th></tr>
                </thead>
                <tbody>
                  {officialResult.records.map((record, index) => (
                    <tr key={`print-${record.courseCode || record.courseTitle}-${record.semester}-${index}`}>
                      <td>{[record.semester, record.academicYear].filter(Boolean).join(" · ") || "—"}</td>
                      <td>{record.courseCode || "—"}</td>
                      <td>{record.courseTitle || "—"}</td>
                      <td>{record.credits}</td>
                      <td>{record.marks ?? "—"}</td>
                      <td>{record.grade}</td>
                      <td>{Number(record.gradePoint).toFixed(2)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <div className="official-result-summary">
                <div><span>{officialResult.summary.gpaSource === "university" ? "University-reported GPA" : officialResult.summary.gpaSource === "calculated" ? "GPA calculated from result" : "GPA not available"}</span><strong>{officialResult.summary.gpa === null ? "—" : Number(officialResult.summary.gpa).toFixed(2)}</strong></div>
                <div><span>{officialResult.summary.cgpaSource === "university" ? "University-reported CGPA" : officialResult.summary.cgpaSource === "calculated" ? "CGPA calculated from result" : "CGPA not available"}</span><strong>{officialResult.summary.cgpa === null ? "—" : Number(officialResult.summary.cgpa).toFixed(2)}</strong></div>
                <div><span>Quality Points</span><strong>{Number(officialResult.summary.totalQualityPoints).toFixed(2)}</strong></div>
                <div><span>Attempted Credits</span><strong>{Number(officialResult.summary.totalAttemptedCredits).toFixed(2)}</strong></div>
              </div>
              {officialResult.semesters.length > 1 && (
                <div className="official-semester-summaries">
                  {officialResult.semesters.map((semester, index) => (
                    <p key={`${semester.semester}-${semester.academicYear}-${index}`}>
                      {[semester.semester, semester.academicYear].filter(Boolean).join(" · ") || `Term ${index + 1}`}:
                      {" "}GPA {semester.gpa === null ? "—" : Number(semester.gpa).toFixed(2)}
                      {semester.cgpa === null ? "" : ` · CGPA ${Number(semester.cgpa).toFixed(2)}`}
                    </p>
                  ))}
                </div>
              )}
              <p className="official-result-source">
                Source: {officialResult.source.label}
                {officialResult.source.uploadedAt && ` · Uploaded ${new Date(officialResult.source.uploadedAt).toLocaleDateString()}`}
              </p>
              <p className="result-print-date">Generated {officialPrintDate}</p>
            </>
          ) : (
            <p className="official-result-message">{message || officialResult?.message || "Your result was not found in the currently uploaded university result document."}</p>
          )}
        </div>
      )}
    </section>
  );
}

function Notices() {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    apiFetch("/api/notices")
      .then(async (response) => {
        if (!response.ok) throw new Error("Unable to load notices.");
        const result = await response.json();
        if (active) setItems(result);
      })
      .catch((loadError) => { if (active) setError(loadError.message); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, []);

  async function openSchedule() {
    try {
      const response = await apiFetch("/api/transport/schedule/current/pdf");
      if (!response.ok) throw new Error("The current transport schedule is not available.");
      const url = URL.createObjectURL(await response.blob());
      const link = document.createElement("a");
      link.href = url;
      link.target = "_blank";
      link.rel = "noopener";
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
    } catch (scheduleError) {
      setError(scheduleError.message);
    }
  }

  if (loading) return <div className="transport-empty">Loading notices…</div>;
  return (
    <div className="notice-grid">
      {error && <div className="transport-alert error" role="alert">{error}</div>}
      {!items.length && !error && <div className="transport-empty">No notices have been published for you.</div>}
      {items.map((notice) => (
        <div className="card notice-card" key={notice.id}>
          <span className="notice-date">{new Date(notice.createdAt).toLocaleDateString()}</span>
          <h3>{notice.title}</h3>
          <p>{notice.body}</p>
          {notice.transportScheduleId && <button className="outline-button" onClick={openSchedule}>View current transport schedule</button>}
        </div>
      ))}
    </div>
  );
}

function Resources() {
  const resources = [
    ["📄", "AI Lecture Notes", "Artificial Intelligence"],
    ["📊", "Database ER Diagram", "Database Management"],
    ["📚", "Software Engineering Book", "Software Engineering"],
    ["🎥", "Data Visualization Lecture", "Data Visualization"],
  ];

  return (
    <div className="resource-grid">
      {resources.map((r) => (
        <div className="card resource-card" key={r[1]}>
          <div className="resource-icon">{r[0]}</div>
          <h3>{r[1]}</h3>
          <span>{r[2]}</span>
          <button className="outline-button">Open Resource</button>
        </div>
      ))}
    </div>
  );
}

function Quiz() {
  return (
    <div className="quiz-container">
      <div className="quiz-card">
        <span className="eyebrow">PRACTICE QUIZ</span>
        <h2>Artificial Intelligence</h2>
        <p>Test your knowledge with AI-generated and instructor-created questions.</p>

        <div className="quiz-stats">
          <div>
            <strong>10</strong>
            <span>Questions</span>
          </div>
          <div>
            <strong>15</strong>
            <span>Minutes</span>
          </div>
          <div>
            <strong>100</strong>
            <span>Marks</span>
          </div>
        </div>

        <button className="primary-button">Start Quiz</button>
      </div>
    </div>
  );
}

function LegacyBusDemo() {
  const [updatedAt, setUpdatedAt] = useState(null);
  const stops = [
    { name: "Main Gate", x: 82, y: 274 },
    { name: "Faculty Building", x: 300, y: 174 },
    { name: "Library", x: 510, y: 98 },
  ];

  return (
    <div className="bus-page">
      <div className="bus-page-heading">
        <div>
          <span className="bus-kicker">CAMPUS TRANSPORT</span>
          <h1>Bus Tracker</h1>
          <p>See your route, stops, and the demo vehicle location.</p>
        </div>
        <button
          className="bus-refresh"
          onClick={() => setUpdatedAt(new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }))}
        >
          <span aria-hidden="true">↻</span>
          Refresh
        </button>
      </div>

      <section className="bus-summary" aria-label="Vehicle and route summary">
        <div className="bus-summary-card">
          <span className="bus-summary-icon">▣</span>
          <div><small>VEHICLE</small><strong>Bus A1</strong></div>
        </div>
        <div className="bus-summary-card">
          <span className="bus-summary-icon">⌘</span>
          <div><small>ROUTE</small><strong>Academic Loop</strong></div>
        </div>
        <div className="bus-summary-card">
          <span className="bus-summary-icon">⌖</span>
          <div><small>STOPS</small><strong>3 stops</strong></div>
        </div>
        <div className="bus-summary-card">
          <span className="feed-dot" />
          <div><small>LOCATION FEED</small><strong>Demo preview</strong></div>
        </div>
      </section>

      <div className="bus-content-grid">
        <section className="bus-map-card">
          <div className="bus-map-heading">
            <div>
              <span className="map-status"><span /> CAMPUS ROUTE</span>
              <h2>Academic Loop</h2>
            </div>
            <span className="demo-gps">▥ &nbsp;DEMO GPS</span>
          </div>
          <div className="campus-map" role="img" aria-label="Illustrated Academic Loop map from Main Gate to Faculty Building to Library">
            <svg viewBox="0 0 600 320" preserveAspectRatio="none" aria-hidden="true">
              <rect width="600" height="320" fill="#edf7f4" />
              <path d="M0 46 C82 79 118 42 196 62 S333 103 421 53 S537 34 600 52 L600 0 0 0Z" fill="#dff2ef" />
              <path d="M0 292 C99 252 143 304 246 276 S410 242 600 293 L600 320 0 320Z" fill="#e2f2ee" />
              <g fill="#d9eae3" stroke="#d1e4dc">
                <rect x="78" y="66" width="52" height="29" rx="8" />
                <rect x="344" y="63" width="60" height="30" rx="8" />
                <rect x="226" y="172" width="52" height="30" rx="8" />
                <rect x="474" y="198" width="57" height="34" rx="9" />
                <rect x="218" y="260" width="48" height="26" rx="8" />
                <rect x="320" y="247" width="64" height="34" rx="9" />
              </g>
              <g fill="none" stroke="#fff" strokeWidth="17" strokeLinecap="round">
                <path d="M38 -12 C92 72 52 132 110 202 S146 282 111 337" />
                <path d="M434 -20 C393 58 458 108 425 185 S433 269 499 337" />
                <path d="M-12 148 C91 127 156 157 238 135 S397 153 612 100" />
                <path d="M-10 306 C105 272 166 310 257 285 S421 268 612 314" />
              </g>
              <g fill="none" stroke="#d9e7e4" strokeWidth="2" strokeDasharray="7 8">
                <path d="M-12 148 C91 127 156 157 238 135 S397 153 612 100" />
                <path d="M-10 306 C105 272 166 310 257 285 S421 268 612 314" />
              </g>
              <path d="M82 274 C150 243 220 211 300 174 S430 127 510 98" fill="none" stroke="#fff" strokeWidth="12" strokeLinecap="round" />
              <path d="M82 274 C150 243 220 211 300 174 S430 127 510 98" fill="none" stroke="#159c91" strokeWidth="6" strokeLinecap="round" />
              <path d="M300 174 C370 147 436 119 510 98" fill="none" stroke="#2387e8" strokeWidth="6" strokeLinecap="round" />
              {stops.map((stop, index) => (
                <g key={stop.name}>
                  <circle cx={stop.x} cy={stop.y} r="8" fill="white" stroke="#1ba47f" strokeWidth="4" />
                  <circle cx={stop.x} cy={stop.y} r="2.5" fill="#1ba47f" />
                  {index < 2 && <text x={stop.x} y={stop.y + 25} textAnchor="middle" className="map-stop-label">{stop.name}</text>}
                  {index === 2 && <text x={stop.x - 2} y={stop.y - 18} textAnchor="end" className="map-building-label">Library</text>}
                </g>
              ))}
              <g transform="translate(340 158)">
                <circle r="15" fill="#2387e8" opacity=".16" />
                <circle r="11" fill="#fff" />
                <circle r="9" fill="#2387e8" />
                <text y="4" textAnchor="middle" className="map-bus-icon">▰</text>
              </g>
              <g transform="translate(555 45)">
                <circle r="16" fill="#fff" />
                <path d="M0 -10 4 2 0 0 -4 2Z" fill="#24516a" />
                <text y="27" textAnchor="middle" className="map-north">N</text>
              </g>
            </svg>
          </div>
          <div className="map-caption">
            <span><i className="legend-route" /> Academic Loop</span>
            <span><i className="legend-bus" /> Demo vehicle position</span>
            <span>Updated {updatedAt || "just now"}</span>
          </div>
        </section>

        <aside className="bus-sidebar">
          <section className="next-stop-card">
            <span className="next-stop-icon">➤</span>
            <small>NEXT STOP</small>
            <h2>Library</h2>
            <p>Bus A1 · Academic Loop</p>
            <span className="demo-location-pill">Demo location only</span>
          </section>

          <section className="route-stops-card">
            <div className="route-stops-heading">
              <h3>Route stops</h3><span>3</span>
            </div>
            <ol className="route-stop-list">
              {stops.map((stop, index) => (
                <li className={index < 2 ? "stop-complete" : "stop-next"} key={stop.name}>
                  <span className="stop-marker">{index < 2 ? "✓" : "3"}</span>
                  <span>{stop.name}</span>
                  {index === 2 && <small>Next</small>}
                </li>
              ))}
            </ol>
          </section>
          <p className="bus-demo-note">This is a sample route preview, not live GPS tracking.</p>
        </aside>
      </div>
    </div>
  );
}

function Assistant() {
  const documentInputRef = useRef(null);
  const [messages, setMessages] = useState([
    {
      from: "ai",
      text: "Hello! I'm your Smart University assistant. How can I help you?",
    },
  ]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [uploadedDocument, setUploadedDocument] = useState(null);
  const [error, setError] = useState("");

  async function submitPrompt(messageText) {
    const prompt = messageText.trim();
    if (!prompt || sending) return;

    setMessages((current) => [...current, { from: "user", text: prompt }]);
    setInput("");
    setError("");
    setSending(true);

    try {
      const history = [
        ...messages.slice(1).map((message) => ({
          role: message.from === "ai" ? "assistant" : "user",
          content: message.text,
        })),
        { role: "user", content: prompt },
      ].slice(-20);
      const response = await apiFetch("/api/ai/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messages: history,
          documentText: uploadedDocument?.text || "",
        }),
      });
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error || "Unable to get an AI response.");
      }
      setMessages((current) => [...current, { from: "ai", text: data.answer }]);
    } catch (requestError) {
      setError(requestError.message || "Unable to connect to the AI assistant.");
    } finally {
      setSending(false);
    }
  }

  function sendMessage(event) {
    event.preventDefault();
    return submitPrompt(input);
  }

  async function uploadDocument(event) {
    const file = event.target.files?.[0];
    if (!file) return;

    setUploading(true);
    setError("");
    try {
      const formData = new FormData();
      formData.append("file", file);
      const response = await apiFetch("/api/ai/document", {
        method: "POST",
        body: formData,
      });
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error || "Unable to read this document.");
      }

      setUploadedDocument(data);
      setMessages([
        {
          from: "ai",
          text: `${data.fileName} is ready. Ask a question, or use one of the options below.${data.truncated ? " The document was long, so only its first section is available to the assistant." : ""}`,
        },
      ]);
    } catch (uploadError) {
      setError(uploadError.message || "Unable to upload this document.");
    } finally {
      setUploading(false);
      if (documentInputRef.current) documentInputRef.current.value = "";
    }
  }

  function clearDocument() {
    setUploadedDocument(null);
    setMessages([
      {
        from: "ai",
        text: "Document removed. You can continue with general questions or upload another file.",
      },
    ]);
    setError("");
  }

  return (
    <div className="assistant">
      <div className="card chat-card">
        <div className="chat-header">
          <div className="assistant-avatar">✦</div>
          <div>
            <h3>Smart University AI</h3>
            <span>Online Assistant</span>
          </div>
        </div>

        <div className="messages" role="log" aria-live="polite" aria-relevant="additions">
          {messages.map((m, i) => (
            <div className={m.from === "ai" ? "message ai" : "message user"} key={i}>
              {m.text}
            </div>
          ))}
          {sending && <div className="message ai" role="status">Thinking...</div>}
          {error && <p className="chat-error" role="alert">{error}</p>}
          {uploadedDocument && (
            <div className="chat-quick-prompts">
              <button type="button" disabled={sending || uploading} onClick={() => submitPrompt("Summarize the uploaded document. Include its main ideas and important details.")}>
                Summarize document
              </button>
              <button type="button" disabled={sending || uploading} onClick={() => submitPrompt("Create five practice questions with answers based on the uploaded document.")}>
                Create practice questions
              </button>
            </div>
          )}
        </div>

        <div className="chat-document-bar">
          <input
            ref={documentInputRef}
            className="chat-file-input"
            type="file"
            accept=".pdf,.docx,.txt,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,text/plain"
            onChange={uploadDocument}
          />
          <div className="chat-document-actions">
            <button type="button" onClick={() => documentInputRef.current?.click()} disabled={uploading || sending}>
              {uploading ? "Reading document..." : "Upload PDF or document"}
            </button>
            {uploadedDocument && (
              <span className="chat-document-name">
                {uploadedDocument.fileName}
                <button type="button" onClick={clearDocument} disabled={sending || uploading} aria-label="Remove uploaded document">×</button>
              </span>
            )}
          </div>
          <p>PDF, DOCX, or TXT · up to 10 MB. Text is sent to Groq for answers and is not saved by the portal.</p>
        </div>

        <form className="chat-input" onSubmit={sendMessage}>
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            maxLength={5000}
            disabled={uploading}
            placeholder={uploadedDocument ? "Ask a question about your document..." : "Ask about courses, payments, results..."}
            aria-label="Message the AI assistant"
          />
          <button type="submit" disabled={sending || uploading || !input.trim()}>Send</button>
        </form>
      </div>
    </div>
  );
}

createRoot(document.getElementById("root")).render(<App />);
