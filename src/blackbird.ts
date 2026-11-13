/** Published design-cruise envelope, not a certified SR-71 flight model. */
export const BLACKBIRD={
 name:'SR-71 performance',cruiseMach:3.2,cruiseAltitude:25000,ceiling:85000*.3048,
 loadedMass:140000*.45359237,fuelMass:80000*.45359237,
 afterburnerThrust:2*32500*4.4482216152605,
 wingArea:1605*.09290304, // NASA/TP-2000-209023 aerodynamic reference area; coefficients remain simplified
 range:2800*1852, // typical operational unrefuelled range; mission tour uses labelled virtual refuelling
 source:'https://www.nasa.gov/wp-content/uploads/2021/09/495839main_fs-030_sr-71.pdf',
 rangeSource:'https://ntrs.nasa.gov/api/citations/20090007797/downloads/20090007797.pdf',
};
