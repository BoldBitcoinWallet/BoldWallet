cmake_minimum_required(VERSION 3.22.1)
project(boldwallet_dkls)

set(CMAKE_C_FLAGS "${CMAKE_C_FLAGS} -Wl,-z,max-page-size=0x4000")
set(CMAKE_CXX_FLAGS "${CMAKE_CXX_FLAGS} -Wl,-z,max-page-size=0x4000")
set(CMAKE_SHARED_LINKER_FLAGS "${CMAKE_SHARED_LINKER_FLAGS} -Wl,-z,max-page-size=0x4000")

# Prebuilt Go shared library (built by BBMTLib/build-dkls.sh android)
set(DKLSMOBILE_DIR ${CMAKE_SOURCE_DIR}/src/main/jniLibs/${ANDROID_ABI})
set(DKLSMOBILE_SO ${DKLSMOBILE_DIR}/libdklsmobile.so)

if(EXISTS ${DKLSMOBILE_SO})
    add_library(dklsmobile SHARED IMPORTED)
    set_target_properties(dklsmobile PROPERTIES IMPORTED_LOCATION ${DKLSMOBILE_SO})

    add_library(dkls_jni SHARED src/main/cpp/dkls_jni.cpp)
    target_include_directories(dkls_jni PRIVATE src/main/cpp)
    target_link_libraries(dkls_jni dklsmobile log android)
endif()
