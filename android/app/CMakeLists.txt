cmake_minimum_required(VERSION 3.22.1)
project(boldwallet_dkls)

set(CMAKE_C_FLAGS "${CMAKE_C_FLAGS} -Wl,-z,max-page-size=0x4000")
set(CMAKE_CXX_FLAGS "${CMAKE_CXX_FLAGS} -Wl,-z,max-page-size=0x4000")
set(CMAKE_SHARED_LINKER_FLAGS "${CMAKE_SHARED_LINKER_FLAGS} -Wl,-z,max-page-size=0x4000")

# Prebuilt unified Go shared library (BBMTLib/build-dkls.sh android → ./bbmtmobile).
# Android MPC: libbbmtmobile.so via dkls_jni (Bbmt* + Dkls*); no gomobile tss.aar.
set(BBMTMOBILE_DIR ${CMAKE_SOURCE_DIR}/src/main/jniLibs/${ANDROID_ABI})
set(BBMTMOBILE_SO ${BBMTMOBILE_DIR}/libbbmtmobile.so)

if(EXISTS ${BBMTMOBILE_SO})
    add_library(bbmtmobile SHARED IMPORTED)
    set_target_properties(bbmtmobile PROPERTIES IMPORTED_LOCATION ${BBMTMOBILE_SO})

    add_library(dkls_jni SHARED src/main/cpp/dkls_jni.cpp)
    target_include_directories(dkls_jni PRIVATE src/main/cpp)
    target_link_libraries(dkls_jni bbmtmobile log android)
endif()
